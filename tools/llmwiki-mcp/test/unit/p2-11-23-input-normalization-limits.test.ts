/**
 * P2-11 입력 정규화(런타임) · P2-23 입력 상한 · P2-08 alias 리다이렉트/미존재 (DESIGN §3 입력 내결함성, §5 입력 상한).
 * 모두 실제 MCP 클라이언트 경로로 호출한다(스키마가 아닌 핸들러 첫 줄에서 정규화·검증되는지 확인).
 */
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESPONSE_LIMIT, TEXT_LIMIT, TRUNC_MARKER, capPages } from "../../src/tools.js";
import { FIXTURE_VAULT, connect, text, type Connected } from "./p2-helpers.js";

const TRUNC_MARK = "\n…[truncated at 200 KB]\n";
const MARK_BYTES = Buffer.byteLength(TRUNC_MARK, "utf8"); // 26 — 마커도 예산 안(codex 2차 #4): 응답 전체 ≤ TEXT_LIMIT
const HALF = Math.floor(RESPONSE_LIMIT / 2); // envelope 초과 시 텍스트 재절단 예산(codex 3차 MAJOR-4)

let c: Connected;
beforeAll(async () => {
  c = await connect(FIXTURE_VAULT, { structured: true });
});
afterAll(async () => c.close());

async function expectError(name: string, args: Record<string, unknown>, msgRe?: RegExp): Promise<string> {
  const r = await c.call(name, args);
  expect(r.isError, `${name} ${JSON.stringify(args)} should be isError; got: ${text(r).slice(0, 120)}`).toBe(true);
  expect(text(r).length).toBeGreaterThan(0);
  expect(text(r)).not.toContain("\n"); // 한 줄 메시지
  if (msgRe) expect(text(r)).toMatch(msgRe);
  return text(r);
}

describe("P2-11 input normalization (runtime)", () => {
  it("P2-11 terms 가 단일 문자열이면 공백 분할 — 배열 입력과 동일 결과", async () => {
    const a = await c.call("wiki_search", { terms: "벡터 인덱스" });
    const b = await c.call("wiki_search", { terms: ["벡터", "인덱스"] });
    expect(a.isError).toBeFalsy();
    expect(text(a)).toBe(text(b));
    expect((a.structuredContent as Record<string, unknown>).rows).toEqual((b.structuredContent as Record<string, unknown>).rows);
    const e = await c.call("wiki_expand", { terms: "벡터   인덱스" });
    const f = await c.call("wiki_expand", { terms: ["벡터", "인덱스"] });
    expect(text(e)).toBe(text(f));
  });

  const SLUG_VARIANTS = ["[[concept-reranking]]", "concept-reranking.md", "wiki/L3-semantic/concept-reranking", "concept-reranking|alias", "concept-reranking#sec", "  concept-reranking  ", "[[wiki/L3-semantic/concept-reranking.md|표시]]"];
  for (const v of SLUG_VARIANTS) {
    it(`P2-11 wiki_read_page slug ${JSON.stringify(v)} → concept-reranking 으로 정규화`, async () => {
      const r = await c.call("wiki_read_page", { slug: v });
      expect(r.isError, text(r)).toBeFalsy();
      const sc = r.structuredContent as Record<string, unknown>;
      expect(sc.slug).toBe("concept-reranking");
      expect(sc.resolved_from_alias).toBe(false);
      expect(sc.path).toBe("wiki/L3-semantic/concept-reranking.md");
    });
    it(`P2-11 wiki_pack slugs [${JSON.stringify(v)}] → concept-reranking 으로 정규화`, async () => {
      const r = await c.call("wiki_pack", { slugs: [v] });
      expect(r.isError, text(r)).toBeFalsy();
      const pages = (r.structuredContent as Record<string, unknown>).pages as Record<string, unknown>[];
      expect(pages).toHaveLength(1);
      expect(pages[0].slug).toBe("concept-reranking");
      expect(pages[0].found).toBe(true);
      expect(text(r).startsWith("## concept-reranking  [")).toBe(true);
    });
  }

  it("P2-11 잘못된 타입 — terms: 5 / slugs: {} / slug: 3 → isError + 메시지", async () => {
    await expectError("wiki_search", { terms: 5 }, /terms/);
    await expectError("wiki_expand", { terms: 5 }, /terms/);
    await expectError("wiki_expand", { terms: [1, 2] }, /terms/);
    await expectError("wiki_pack", { slugs: {} }, /slugs/);
    await expectError("wiki_read_page", { slug: 3 }, /slug/);
    await expectError("wiki_search", {}, /terms/);
    await expectError("wiki_pack", {}, /slugs/);
    await expectError("wiki_read_page", {}, /slug/);
  });

  it("P2-11 정수 옵션 — 문자열 정수 허용, 소수/범위 밖 거부", async () => {
    const ok = await c.call("wiki_search", { terms: ["rerank"], top: "8" });
    expect(ok.isError).toBeFalsy();
    const ok2 = await c.call("wiki_search", { terms: ["rerank"], top: 8 });
    expect(text(ok)).toBe(text(ok2));
    await expectError("wiki_search", { terms: ["rerank"], top: "1.5" }, /top/);
    await expectError("wiki_search", { terms: ["rerank"], top: 1.5 }, /top/);
    await expectError("wiki_search", { terms: ["rerank"], top: 0 }, /top.*range/);
    await expectError("wiki_search", { terms: ["rerank"], top: 51 }, /top.*range/);
    await expectError("wiki_expand", { terms: ["rerank"], max: 51 }, /max.*range/);
    await expectError("wiki_expand", { terms: ["rerank"], max: 0 }, /max.*range/);
    await expectError("wiki_expand", { terms: ["rerank"], rerank: -1 }, /rerank.*range/);
    await expectError("wiki_expand", { terms: ["rerank"], rerank: 51 }, /rerank.*range/);
    await expectError("wiki_expand", { terms: ["rerank"], top_seed: 21 }, /top_seed.*range/);
    await expectError("wiki_expand", { terms: ["rerank"], top_seed: "abc" }, /top_seed/);
    const dflt = await c.call("wiki_expand", { terms: ["rerank"], max: null, rerank: undefined });
    expect(dflt.isError).toBeFalsy();
    expect((dflt.structuredContent as Record<string, unknown>).suggested_next).toBe("wiki_read_page"); // 기본값 max 15 · rerank 0
  });

  it("P2-11 unknown tool → isError", async () => {
    await expectError("wiki_nope", {}, /unknown tool/);
  });
});

describe("P2-08 wiki_read_page alias / not found", () => {
  it("P2-08 alias 1회 리다이렉트 — 별칭페이지 → concept-alias-target", async () => {
    const r = await c.call("wiki_read_page", { slug: "별칭페이지" });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.slug).toBe("concept-alias-target");
    expect(sc.resolved_from_alias).toBe(true);
    expect(sc.path).toBe("wiki/L3-semantic/concept-alias-target.md");
    expect(text(r).startsWith("---\n")).toBe(true); // frontmatter 포함 전문
    const q = await c.call("wiki_read_page", { slug: "quoted alias" }); // 공백 포함 alias 도 허용 문자
    expect(q.isError).toBeFalsy();
    expect((q.structuredContent as Record<string, unknown>).slug).toBe("concept-alias-target");
  });
  it("P2-08 없는 slug → isError 'page not found: <slug>'", async () => {
    expect(await expectError("wiki_read_page", { slug: "nonexistent-slug" })).toBe("page not found: nonexistent-slug");
    expect(await expectError("wiki_read_page", { slug: "[[nonexistent-slug]]" })).toBe("page not found: nonexistent-slug"); // 정규화 후 slug 로 보고
  });
});

describe("P2-23 input limits", () => {
  it("P2-23 terms 11개 → isError, 10개 OK", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect((await c.call("wiki_search", { terms: ten })).isError).toBeFalsy();
    await expectError("wiki_search", { terms: [...ten, "t10"] }, /too many terms/);
    await expectError("wiki_expand", { terms: [...ten, "t10"] }, /too many terms/);
    await expectError("wiki_search", { terms: ten.concat("t10").join(" ") }, /too many terms/); // 문자열 분할 후에도 상한 적용
  });
  it("P2-23 65자 term → isError, 64자 OK", async () => {
    expect((await c.call("wiki_search", { terms: ["a".repeat(64)] })).isError).toBeFalsy();
    await expectError("wiki_search", { terms: ["a".repeat(65)] }, /term too long/);
    await expectError("wiki_expand", { terms: ["가".repeat(65)] }, /term too long/);
  });
  it("P2-23 slugs 31개 → isError, 30개 OK", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `s${i}`);
    expect((await c.call("wiki_pack", { slugs: thirty })).isError).toBeFalsy();
    await expectError("wiki_pack", { slugs: [...thirty, "s30"] }, /too many slugs/);
  });
  it("P2-23 121자 slug → isError, 120자 OK(없는 페이지로 처리)", async () => {
    const s120 = "a".repeat(120);
    expect(await expectError("wiki_read_page", { slug: s120 })).toBe(`page not found: ${s120}`);
    await expectError("wiki_read_page", { slug: "a".repeat(121) }, /slug too long/);
    await expectError("wiki_pack", { slugs: ["a".repeat(121)] }, /slug too long/);
    const p = await c.call("wiki_pack", { slugs: [s120] });
    expect(p.isError).toBeFalsy();
  });
  it("P2-23 빈 terms / 공백만인 terms / 빈 slugs → isError", async () => {
    await expectError("wiki_search", { terms: [] }, /terms/);
    await expectError("wiki_search", { terms: ["  ", ""] }, /terms/);
    await expectError("wiki_expand", { terms: "   " }, /terms/);
    await expectError("wiki_pack", { slugs: [] }, /slugs/);
    await expectError("wiki_pack", { slugs: ["", "  "] }, /slugs/);
  });
});

describe("P2-23 / P2-10 200 KB text cap (temp vault)", () => {
  let root = "";
  let big: Connected;
  const BIG_PAGE_BODY_LEN = 250 * 1024;
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llmwiki-p2-big-")));
    await mkdir(path.join(root, "wiki", "L3-semantic"), { recursive: true });
    // 250 KB 페이지(ASCII 라 UTF-16 길이 = 바이트)
    const body = "x".repeat(BIG_PAGE_BODY_LEN);
    await writeFile(path.join(root, "wiki", "L3-semantic", "big-page.md"), `---\ntype: concept\nconfidence: 0.6\n---\n# big\n${body}\n`, "utf8");
    // claim 줄만으로 > 200 KB 인 페이지 — wiki_pack 텍스트 상한 검증
    const claims = Array.from({ length: 6000 }, (_, i) => `- claim:: claim number ${i} ${"y".repeat(40)}`).join("\n");
    await writeFile(path.join(root, "wiki", "L3-semantic", "many-claims.md"), `---\ntype: fact\nconfidence: 0.85\n---\n${claims}\n`, "utf8");
    expect(claims.length).toBeGreaterThan(TEXT_LIMIT);
    await writeFile(path.join(root, "wiki", "L3-semantic", "small-page.md"), "---\ntype: concept\n---\n# small\n- claim:: tiny claim\n", "utf8");
    big = await connect(root, { structured: true });
  });
  afterAll(async () => {
    await big?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("P2-23 wiki_read_page > 200 KB → truncated:true + 절단 마커, 응답 envelope 전체가 200 KB 이내(codex 3차 MAJOR-4)", async () => {
    expect(TRUNC_MARKER).toBe(TRUNC_MARK);
    const r = await big.call("wiki_read_page", { slug: "big-page" });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.truncated).toBe(true);
    expect(text(r).endsWith(TRUNC_MARK)).toBe(true);
    // text 만 200 KB 로 잘라도 JSON 전체는 상한을 넘는다(3차 MAJOR-4). 텍스트는 content 와 structuredContent 에 **두 번** 실리므로
    // **전송되는 응답 전체**를 재야 한다 — 예전 단언은 structuredContent 만 재서 '정확히 절반'을 기대했고, 실제 전송량은 상한을
    // 넘었다(P4-27 에서 검출·정정). 텍스트는 절반 이하이면서 예산을 거의 다 쓴다(과절단 금지).
    const wireBytes = Buffer.byteLength(JSON.stringify({ content: r.content, structuredContent: sc }), "utf8");
    expect(wireBytes).toBeLessThanOrEqual(RESPONSE_LIMIT);
    expect(Buffer.byteLength(text(r), "utf8")).toBeLessThanOrEqual(HALF);
    expect(Buffer.byteLength(text(r), "utf8")).toBeGreaterThan(HALF - 2048); // ASCII 본문 — 이스케이프가 없어 거의 절반까지 채운다
    expect(text(r)).toBe(sc.text);
    expect((sc.frontmatter as Record<string, unknown>).type).toBe("concept"); // 절단이 frontmatter 요약에는 영향 없음
  });

  it("P2-23 wiki_pack > 200 KB → truncated:true + 절단 마커, envelope 전체 ≤ 200 KB 이고 pages 는 비워진다(codex 3차 MAJOR-4)", async () => {
    const r = await big.call("wiki_pack", { slugs: ["many-claims"] });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.truncated).toBe(true);
    expect(text(r).endsWith(TRUNC_MARK)).toBe(true);
    // 상한은 UTF-8 **바이트** 기준(리뷰: 팩 텍스트에 한글 헤더가 섞여 UTF-16 길이 ≠ 바이트) — 마커 앞 본문이 예산 안에서 최대.
    // envelope 초과 응답이므로 텍스트는 절반 이하. 줄마다 개행이 JSON 에서 2바이트로 부푸는 몫만큼 비례 보정되어 절반보다 조금 작다.
    const bodyBytes = Buffer.byteLength(text(r).slice(0, -TRUNC_MARK.length), "utf8");
    expect(bodyBytes).toBeLessThanOrEqual(HALF - MARK_BYTES);
    expect(bodyBytes).toBeGreaterThan(Math.floor(HALF * 0.9)); // 과절단 금지(고정 비율 축소는 여기서 1/8 까지 떨어졌다)
    expect(Buffer.byteLength(text(r), "utf8")).toBeLessThanOrEqual(HALF); // 마커 포함 전체 ≤ 절반 예산
    expect(text(r)).toBe(sc.text);
    // **전송되는 응답 전체**(content + structuredContent)가 상한 이내 — text·pages 를 각각 잘라도 합이 넘던 결함의 회귀 가드
    expect(Buffer.byteLength(JSON.stringify({ content: r.content, structuredContent: sc }), "utf8")).toBeLessThanOrEqual(RESPONSE_LIMIT);
    expect(sc.pages).toEqual([]); // wiki_pack 은 envelope 축소 시 pages 를 비운다(텍스트가 1차 표현)
  });

  it("P2-23 capPages 자체는 페이지 예산으로 claims 를 뒤에서부터 떨어뜨린다(리뷰 BLOCKER: structuredContent 우회 금지)", () => {
    // envelope 축소 경로가 pages 를 비우므로 MCP 응답에서는 관측되지 않는다 — 단위 함수로 계약을 고정한다.
    const claims = Array.from({ length: 6000 }, (_, i) => `claim number ${i} ${"y".repeat(40)}`);
    const page = { slug: "many-claims", found: true, type: "fact", confidence: "0.85", status: "active", claims, summary: "", relations: [] as string[] };
    const capped = capPages([page]);
    expect(capped.truncated).toBe(true);
    expect(capped.pages).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(capped.pages), "utf8")).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(capped.pages[0].claims.length).toBeGreaterThan(0);
    expect(capped.pages[0].claims.length).toBeLessThan(6000);
    expect(capped.pages[0].claims[0]).toBe(`claim number 0 ${"y".repeat(40)}`); // 앞쪽은 보존, 뒤에서부터 떨어뜨린다
    expect(capPages([{ ...page, claims: ["one tiny claim"] }]).truncated).toBe(false);
  });

  it("P2-10 상한 이하 페이지는 truncated:false", async () => {
    const r = await big.call("wiki_pack", { slugs: ["small-page"] });
    expect((r.structuredContent as Record<string, unknown>).truncated).toBe(false);
    expect(text(r).endsWith(TRUNC_MARK)).toBe(false);
    const p = await big.call("wiki_read_page", { slug: "small-page" });
    expect((p.structuredContent as Record<string, unknown>).truncated).toBe(false);
    // big-page 는 claim 이 없어 250 KB 본문 줄이 그대로 (요약) 이 된다 → pack 도 절단 대상
    const b = await big.call("wiki_pack", { slugs: ["big-page"] });
    expect((b.structuredContent as Record<string, unknown>).truncated).toBe(true);
  });
});

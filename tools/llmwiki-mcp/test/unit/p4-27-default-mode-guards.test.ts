/**
 * P4-27+ 외부리뷰(codex·agy) 반영 — **기본(텍스트 전용) 모드**에서도 P2 의 보안·상한 규칙이 그대로 지켜지는지.
 *
 * 기존 P2 테스트는 structuredContent 계약을 검사하므로 opt-in(`structured: true`)으로 돈다. 사용자가 실제로 쓰는 경로는
 * 기본 모드이므로, 핵심 경로를 두 모드에서 나란히 돌려 결과(오류 여부·오류 문구)가 같고 기본 모드의 응답 JSON 전체가
 * RESPONSE_LIMIT 안에 드는지 확인한다. 큰 응답에서 두 모드의 텍스트가 달라지는 것(opt-in 은 structuredContent 에 text 가
 * 한 번 더 실려 더 줄어든다)은 **의도된 차이**로 명시적으로 고정한다.
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool } from "../../src/server.js";
import { RESPONSE_LIMIT, TRUNC_MARKER } from "../../src/tools.js";
import { FIXTURE_VAULT, text } from "./p2-helpers.js";

const envelopeBytes = (r: unknown): number => Buffer.byteLength(JSON.stringify(r), "utf8");
const both = async (root: string, name: string, args: Record<string, unknown>) =>
  Promise.all([callTool(root, name, args, undefined, false), callTool(root, name, args, undefined, true)]);

describe("기본 모드 — 입력 거부·경로 탈출은 opt-in 과 같은 오류", () => {
  const BAD: [string, Record<string, unknown>][] = [
    ["wiki_read_page", { slug: "../../etc/passwd" }],
    ["wiki_read_page", { slug: "wiki/../x" }],
    ["wiki_read_page", { slug: "%2e%2e%2fsecret" }],
    ["wiki_read_page", { slug: "/abs/path" }],
    ["wiki_read_page", { slug: "no-such-page-xyz" }],
    ["wiki_pack", { slugs: [] }],
    ["wiki_pack", { slugs: ["a\\b"] }],
    ["wiki_search", { terms: 5 }],
    ["wiki_search", { terms: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["wiki_expand", { terms: ["x".repeat(65)] }],
    ["wiki_expand", { terms: ["rerank"], max: 999 }],
    ["wiki_nope", {}],
  ];
  it.each(BAD)("%s %j", async (name, args) => {
    const [off, on] = await both(FIXTURE_VAULT, name, args);
    expect(off.isError).toBe(true);
    expect(on.isError).toBe(true);
    expect(text(off)).toBe(text(on)); // 같은 문구
    expect(off).not.toHaveProperty("structuredContent");
  });
});

describe("기본 모드 — 심볼릭 링크·대형 응답", () => {
  let root = "";
  let outside = "";
  beforeAll(async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p427-"));
    root = await realpath(base);
    outside = path.join(root, "outside-secret.md");
    await writeFile(outside, "---\ntype: fact\n---\n# OUT\nP427-CANARY-SECRET\n", "utf8");
    const dir = path.join(root, "wiki", "L3");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "seed.md"), "---\ntype: concept\n---\n# Seed\ncanaryterm body [[leak]]\n", "utf8");
    try {
      await symlink(outside, path.join(dir, "leak.md"));
    } catch {
      /* 링크 권한 없음 — 해당 단언만 건너뛴다 */
    }
    // JSON 이스케이프로 크게 부푸는 대형 페이지: 개행·따옴표가 가득해 텍스트 200KB 가 envelope 에서 ~2배가 된다.
    const line = 'q"\n';
    await writeFile(path.join(dir, "huge.md"), `---\ntype: fact\n---\n# Huge\n${line.repeat(80_000)}`, "utf8");
  });
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("심볼릭 링크 너머 본문은 어떤 도구의 텍스트에도 실리지 않는다", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["wiki_search", { terms: ["P427-CANARY-SECRET"] }],
      ["wiki_expand", { terms: ["canaryterm"], max: 8 }],
      ["wiki_pack", { slugs: ["seed", "leak"] }],
      ["wiki_read_page", { slug: "leak" }],
    ];
    for (const [name, args] of calls) {
      const r = await callTool(root, name, args, undefined, false);
      expect(text(r)).not.toContain("P427-CANARY-SECRET");
    }
  });

  it("[codex·agy MAJOR] 기본 모드 응답 JSON 전체가 RESPONSE_LIMIT 안 — 이스케이프로 부푸는 대형 페이지에서도", async () => {
    for (const [name, args] of [
      ["wiki_read_page", { slug: "huge" }],
      ["wiki_pack", { slugs: ["huge"] }],
    ] as [string, Record<string, unknown>][]) {
      const r = await callTool(root, name, args, undefined, false);
      expect(r.isError ?? false).toBe(false);
      expect(envelopeBytes(r)).toBeLessThanOrEqual(RESPONSE_LIMIT);
      // read_page 는 본문 전체라 절단 마커가 붙는다. pack 은 본문이 아니라 claims 요약이라(이 페이지엔 claim 이 없다) 작다.
      if (name === "wiki_read_page") expect(text(r)).toContain(TRUNC_MARKER.trim());
    }
  });

  it("[P4-27 테스트가 검출한 P2 결함] opt-in 모드도 **전송되는 응답 전체**가 RESPONSE_LIMIT 안", async () => {
    for (const [name, args] of [
      ["wiki_read_page", { slug: "huge" }],
      ["wiki_pack", { slugs: ["huge"] }],
    ] as [string, Record<string, unknown>][]) {
      const r = await callTool(root, name, args, undefined, true);
      expect(r.isError ?? false).toBe(false);
      expect(envelopeBytes(r)).toBeLessThanOrEqual(RESPONSE_LIMIT); // 예전 측정(structuredContent 만)으로는 341,496B 가 통과했다
    }
  });

  it("[codex·agy MAJOR] 큰 응답에서는 두 모드의 텍스트가 다를 수 있다 — opt-in 이 더 짧거나 같다(의도된 차이)", async () => {
    const [off, on] = await both(root, "wiki_read_page", { slug: "huge" });
    expect(envelopeBytes(on)).toBeLessThanOrEqual(RESPONSE_LIMIT);
    expect(Buffer.byteLength(text(on), "utf8")).toBeLessThanOrEqual(Buffer.byteLength(text(off), "utf8"));
    // 작은 응답에서는 동일(p4-27-text-only-default ②)하므로, 차이는 envelope 예산에서만 생긴다
    const [s1, s2] = await both(root, "wiki_read_page", { slug: "seed" });
    expect(text(s1)).toBe(text(s2));
  });
});

/**
 * 3차 외부리뷰 MAJOR-4 — "text 와 pages 를 각각 200 KB 로 잘라도 **응답 전체**(JSON envelope)는 그 합이라 400 KB 를 넘긴다".
 *
 * 수정 후 계약(server.ts): `JSON.stringify(structuredContent)` 가 RESPONSE_LIMIT(200 KB)를 넘으면 응답을 축소한다 —
 * 텍스트는 RESPONSE_LIMIT/2 로 다시 자르고, `truncated: true`, `wiki_pack` 은 `pages: []` (텍스트가 1차 표현이므로 구조화
 * 사본을 버린다). 여러 개의 큰 페이지를 담은 임시 볼트로 실제 MCP 경로에서 확인한다.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESPONSE_LIMIT, TRUNC_MARKER } from "../../src/tools.js";
import { connect, text, type Connected } from "./p2-helpers.js";

const HALF = Math.floor(RESPONSE_LIMIT / 2);
const BIG_SLUGS = ["big-1", "big-2", "big-3", "big-4", "big-5"];

let root = "";
let c: Connected;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llmwiki-p2r3-env-")));
  await mkdir(path.join(root, "wiki", "L3-semantic"), { recursive: true });
  // 페이지 하나가 claim 만으로 ~80 KB → 5개면 팩 텍스트도 pages 도 각각 200 KB 를 넘고, 합은 훨씬 더 넘는다
  for (const slug of BIG_SLUGS) {
    const claims = Array.from({ length: 800 }, (_, i) => `- claim:: ${slug} claim ${i} ${"z".repeat(80)}`).join("\n");
    await writeFile(path.join(root, "wiki", "L3-semantic", `${slug}.md`), `---\ntype: fact\nconfidence: 0.85\n---\n${claims}\n`, "utf8");
  }
  // 한글 페이지 — 상한이 UTF-16 길이가 아니라 UTF-8 바이트 기준임을 함께 확인
  const kr = Array.from({ length: 3000 }, (_, i) => `- claim:: 한글 클레임 ${i} ${"가".repeat(60)}`).join("\n");
  await writeFile(path.join(root, "wiki", "L3-semantic", "big-kr.md"), `---\ntype: fact\nconfidence: 0.9\n---\n${kr}\n`, "utf8");
  await writeFile(path.join(root, "wiki", "L3-semantic", "tiny.md"), "---\ntype: concept\n---\n# tiny\n- claim:: 아주 작은 주장\n", "utf8");
  c = await connect(root, { structured: true });
});
afterAll(async () => {
  await c?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("3차 MAJOR-4: 응답 envelope 전체 예산(200 KB)", () => {
  it("wiki_pack 응답 전체 JSON 이 200 KB 이내 — 텍스트는 100 KB 로 재절단되고 pages 는 비워진다", async () => {
    const r = await c.call("wiki_pack", { slugs: BIG_SLUGS });
    expect(r.isError, text(r)).toBeFalsy();
    const sc = r.structuredContent as Record<string, unknown>;
    const envelope = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(envelope).toBeLessThanOrEqual(RESPONSE_LIMIT); // 핵심 회귀 가드
    expect(sc.truncated).toBe(true);
    expect(sc.pages).toEqual([]);
    expect(Buffer.byteLength(text(r), "utf8")).toBeLessThanOrEqual(HALF);
    expect(text(r).endsWith(TRUNC_MARKER)).toBe(true);
    expect(text(r)).toBe(sc.text);
    // 잘린 텍스트라도 첫 페이지의 헤더·클레임은 살아있다(앞에서부터 보존)
    expect(text(r)).toContain("big-1");
  }, 30000);

  it("한글 팩도 같은 예산 — 바이트 기준이라 UTF-16 길이는 상한보다 작다", async () => {
    const r = await c.call("wiki_pack", { slugs: ["big-kr"] });
    const sc = r.structuredContent as Record<string, unknown>;
    expect(Buffer.byteLength(JSON.stringify(sc), "utf8")).toBeLessThanOrEqual(RESPONSE_LIMIT);
    expect(sc.truncated).toBe(true);
    expect(sc.pages).toEqual([]);
    expect(Buffer.byteLength(text(r), "utf8")).toBeLessThanOrEqual(HALF);
    expect(text(r).length).toBeLessThan(HALF); // 한글 1자 = 3바이트 → 길이는 바이트보다 짧다
  }, 30000);

  it("wiki_read_page 도 envelope 전체가 200 KB 이내", async () => {
    const r = await c.call("wiki_read_page", { slug: "big-kr" }); // 원문 ~600 KB
    const sc = r.structuredContent as Record<string, unknown>;
    expect(Buffer.byteLength(JSON.stringify(sc), "utf8")).toBeLessThanOrEqual(RESPONSE_LIMIT);
    expect(sc.truncated).toBe(true);
    expect(Buffer.byteLength(text(r), "utf8")).toBeLessThanOrEqual(HALF);
    expect((sc.frontmatter as Record<string, unknown>).type).toBe("fact"); // 축소해도 계약 필드는 남는다
    expect(sc.path).toBe("wiki/L3-semantic/big-kr.md");
    // 예산 안의 페이지는 그대로
    const t = await c.call("wiki_read_page", { slug: "tiny" });
    expect((t.structuredContent as Record<string, unknown>).truncated).toBe(false);
  }, 30000);

  it("예산 안의 응답은 손대지 않는다 — pages 보존, truncated:false", async () => {
    const r = await c.call("wiki_pack", { slugs: ["tiny"] });
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.truncated).toBe(false);
    const pages = sc.pages as Record<string, unknown>[];
    expect(pages).toHaveLength(1);
    expect(pages[0].claims).toEqual(["아주 작은 주장"]);
    expect(Buffer.byteLength(JSON.stringify(sc), "utf8")).toBeLessThan(RESPONSE_LIMIT);
    expect(text(r).endsWith(TRUNC_MARKER)).toBe(false);
  }, 30000);
});

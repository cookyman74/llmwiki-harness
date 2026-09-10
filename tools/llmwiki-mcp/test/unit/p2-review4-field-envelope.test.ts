/**
 * P2 3차 테스트 검토에서 남은 결함: `wiki_read_page` 의 frontmatter 스칼라가 무제한이라 응답 envelope 가 200KB 를 넘었다
 * (text 는 잘려도 `frontmatter.type` 이 300KB 면 envelope 409,776 바이트). 수정: 필드별 FIELD_LIMIT 절단 + envelope 재측정 루프.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool } from "../../src/server.js";
import { FIELD_LIMIT, RESPONSE_LIMIT } from "../../src/tools.js";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "llmwiki-fieldcap-"));
  await mkdir(path.join(root, "wiki", "L3-semantic"), { recursive: true });
  // frontmatter 값 하나가 300 KB — 정상 위키에는 없지만 페이지가 정하는 문자열이라 방어해야 한다
  await writeFile(path.join(root, "wiki", "L3-semantic", "huge-field.md"), `---\ntype: ${"y".repeat(300 * 1024)}\nstatus: ${"s".repeat(50 * 1024)}\n---\n# huge\nbody\n`, "utf8");
  await writeFile(path.join(root, "wiki", "L3-semantic", "normal.md"), "---\ntype: concept\nconfidence: 0.85\nstatus: active\n---\n# normal\n- claim:: 정상 페이지\n", "utf8");
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");

describe("P2 3차: read_page frontmatter 상한과 envelope 재측정", () => {
  it("거대한 frontmatter 값이 있어도 응답 envelope 는 200 KB 이내이고 각 필드는 FIELD_LIMIT 이내", async () => {
    const r = await callTool(realpathSync(root), "wiki_read_page", { slug: "huge-field" }, undefined, true);
    expect(r.isError).toBeUndefined();
    const sc = r.structuredContent as { frontmatter: Record<string, string>; text: string; truncated: boolean };
    expect(bytes(sc)).toBeLessThanOrEqual(RESPONSE_LIMIT);
    for (const [k, v] of Object.entries(sc.frontmatter)) {
      expect(Buffer.byteLength(v, "utf8"), k).toBeLessThanOrEqual(FIELD_LIMIT);
    }
    expect(Buffer.byteLength(sc.text, "utf8")).toBeLessThanOrEqual(RESPONSE_LIMIT);
  });

  it("정상 페이지는 절단 없이 그대로(회귀 방지)", async () => {
    const r = await callTool(realpathSync(root), "wiki_read_page", { slug: "normal" }, undefined, true);
    const sc = r.structuredContent as { frontmatter: Record<string, string>; truncated: boolean };
    expect(sc.truncated).toBe(false);
    expect(sc.frontmatter).toMatchObject({ type: "concept", confidence: "0.85", status: "active" });
    expect(bytes(sc)).toBeLessThan(1024);
  });
});

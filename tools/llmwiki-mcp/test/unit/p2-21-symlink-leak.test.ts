/**
 * P2-21 심볼릭 링크 유출 테스트 (PRD §6, DESIGN §5). 임시 볼트에 `wiki/leak.md → 외부 파일`, `wiki/leakdir → 외부 디렉터리`
 * 를 만들고 4개 도구 전부에서 외부 내용이 노출되지 않는지 확인한다. 링크는 픽스처 밖 tmp 에만 만든다.
 * Windows 에서 심볼릭 링크 권한이 없으면 사유를 남기고 skip (p1-01 패턴).
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, text, type Connected, type ToolResult } from "./p2-helpers.js";

const SECRET = "XYZZY_SECRET_PAYLOAD";
const SECRET_INNER = "PLUGH_INNER_SECRET";
const SEARCH_WORD = "zorkmid"; // 외부 파일에만 등장하는 검색어

let root = "";
let outside = "";
let canSymlink = true;
let skipReason = "";
let c: Connected | undefined;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llmwiki-p2-leak-")));
  outside = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p2-outside-"));
  const wiki = path.join(root, "wiki");
  await mkdir(path.join(wiki, "L3-semantic"), { recursive: true });
  await mkdir(path.join(outside, "secretdir"), { recursive: true });
  await writeFile(path.join(wiki, "L3-semantic", "real-page.md"), "---\ntype: concept\nconfidence: 0.6\naliases: [leakalias]\n---\n# real\n- claim:: visible claim\n", "utf8");
  await writeFile(path.join(outside, "secret.md"), `---\ntype: concept\nconfidence: 0.95\naliases: [leak-alias]\n---\n# secret ${SEARCH_WORD}\n- claim:: ${SECRET}\n- uses :: [[real-page]]\n`, "utf8");
  await writeFile(path.join(outside, "secretdir", "inner-secret.md"), `---\ntype: fact\n---\n# inner ${SEARCH_WORD}\n- claim:: ${SECRET_INNER}\n`, "utf8");
  try {
    await symlink(path.join(outside, "secret.md"), path.join(wiki, "leak.md"), "file");
    await symlink(path.join(outside, "secretdir"), path.join(wiki, "leakdir"), process.platform === "win32" ? "junction" : "dir");
  } catch (e) {
    canSymlink = false;
    skipReason = `symlink creation not permitted here: ${e instanceof Error ? e.message : String(e)}`;
  }
  c = await connect(root);
});
afterAll(async () => {
  await c?.close();
  if (root) await rm(root, { recursive: true, force: true });
  if (outside) await rm(outside, { recursive: true, force: true });
});

function skip(): boolean {
  if (!canSymlink) {
    // eslint-disable-next-line no-console
    console.error(`SKIP: ${skipReason}`);
    return true;
  }
  return false;
}

function assertNoLeak(r: ToolResult): void {
  const all = text(r) + JSON.stringify(r.structuredContent ?? {});
  expect(all).not.toContain(SECRET);
  expect(all).not.toContain(SECRET_INNER);
  expect(all).not.toContain(outside);
}

describe("P2-21 symlink leak", () => {
  it("P2-21 wiki_search 는 링크 대상 내용을 색인하지 않는다", async () => {
    if (skip()) return;
    const r = await (c as Connected).call("wiki_search", { terms: [SEARCH_WORD, SECRET, SECRET_INNER] });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as Record<string, unknown>).rows).toEqual([]);
    expect(text(r).startsWith("no matches for:")).toBe(true);
    assertNoLeak(r);
    const ok = await (c as Connected).call("wiki_search", { terms: ["visible"] });
    expect(((ok.structuredContent as Record<string, unknown>).rows as { slug: string }[]).map((x) => x.slug)).toEqual(["real-page"]);
  });

  it("P2-21 wiki_expand 는 링크 페이지를 seed·1hop 어디에도 넣지 않는다", async () => {
    if (skip()) return;
    const r = await (c as Connected).call("wiki_expand", { terms: [SEARCH_WORD], max: 15 });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as Record<string, unknown>).rows).toEqual([]);
    assertNoLeak(r);
    // 정상 페이지에서 확장해도(외부 파일이 real-page 를 링크함) 인바운드로 leak/inner-secret 이 딸려오지 않는다
    const e = await (c as Connected).call("wiki_expand", { terms: ["visible"], max: 15, rerank: 5 });
    const slugs = ((e.structuredContent as Record<string, unknown>).rows as { slug: string }[]).map((x) => x.slug);
    expect(slugs).toEqual(["real-page"]);
    assertNoLeak(e);
  });

  it("P2-21 wiki_pack ['leak','inner-secret'] 은 (없음)", async () => {
    if (skip()) return;
    const r = await (c as Connected).call("wiki_pack", { slugs: ["leak", "inner-secret", "leak-alias"] });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe("## leak\n(없음)\n\n## inner-secret\n(없음)\n\n## leak-alias\n(없음)\n\n");
    const pages = (r.structuredContent as Record<string, unknown>).pages as { found: boolean; claims: string[] }[];
    expect(pages.map((p) => p.found)).toEqual([false, false, false]);
    assertNoLeak(r);
  });

  it("P2-21 wiki_read_page 'leak' / 'inner-secret' / 외부 alias 는 page not found", async () => {
    if (skip()) return;
    for (const s of ["leak", "inner-secret", "leak-alias"]) {
      const r = await (c as Connected).call("wiki_read_page", { slug: s });
      expect(r.isError, s).toBe(true);
      expect(text(r)).toBe(`page not found: ${s}`);
      assertNoLeak(r);
    }
    const ok = await (c as Connected).call("wiki_read_page", { slug: "real-page" });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as Record<string, unknown>).path).toBe("wiki/L3-semantic/real-page.md");
  });
});

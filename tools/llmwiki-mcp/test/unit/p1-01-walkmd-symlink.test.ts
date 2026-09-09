/**
 * P1-01 #1 walkMd — 심볼릭 링크 엔트리(파일·디렉터리) 스킵 회귀 테스트 (codex P1 2차 리뷰 MINOR-3).
 * Python 정본에는 없는 보안 규칙(DESIGN §5)이라 패리티 대상이 아니며, 픽스처에는 링크를 두지 않는다.
 * Windows 에서 심볼릭 링크 생성 권한이 없으면 사유를 남기고 skip.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGraph } from "../../src/graph.js";
import { walkMd } from "../../src/vault.js";

let root = "";
let outside = "";
let canSymlink = true;
let skipReason = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "llmwiki-symlink-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "llmwiki-outside-"));
  const wiki = path.join(root, "wiki");
  await mkdir(path.join(wiki, "L3"), { recursive: true });
  await mkdir(path.join(outside, "secretdir"), { recursive: true });
  await writeFile(path.join(wiki, "L3", "real-page.md"), "---\ntype: concept\n---\n# real\nvisible 본문\n", "utf8");
  await writeFile(path.join(outside, "secret.md"), "---\ntype: concept\n---\n# secret\nLEAKED_TOKEN 본문\n", "utf8");
  await writeFile(path.join(outside, "secretdir", "inner-secret.md"), "---\ntype: concept\n---\n# inner\nLEAKED_INNER 본문\n", "utf8");
  try {
    await symlink(path.join(outside, "secret.md"), path.join(wiki, "L3", "leak.md"), "file");
    await symlink(path.join(outside, "secretdir"), path.join(wiki, "leakdir"), process.platform === "win32" ? "junction" : "dir");
  } catch (e) {
    canSymlink = false;
    skipReason = `symlink creation not permitted here: ${e instanceof Error ? e.message : String(e)}`;
  }
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  if (outside) await rm(outside, { recursive: true, force: true });
});

describe("P1-01 #1 walkMd symlink skip", () => {
  it("P1-01 #1 파일 symlink 와 디렉터리 symlink 는 순회에서 제외되고 정상 파일만 남는다", async () => {
    if (!canSymlink) {
      // eslint-disable-next-line no-console
      console.error(`SKIP: ${skipReason}`);
      return;
    }
    const files = await walkMd(path.join(root, "wiki"));
    expect(files.map((f) => f.slug)).toEqual(["real-page"]);
  });
  it("P1-01 #1 buildGraph 에도 링크 대상 내용이 적재되지 않는다(search/pack 유출 경로 차단)", async () => {
    if (!canSymlink) return;
    const G = await buildGraph(path.join(root, "wiki"));
    expect([...G.nodes.keys()]).toEqual(["real-page"]);
    const allText = [...G.nodes.values()].map((n) => n.text).join("\n");
    expect(allText).not.toContain("LEAKED_TOKEN");
    expect(allText).not.toContain("LEAKED_INNER");
  });
});

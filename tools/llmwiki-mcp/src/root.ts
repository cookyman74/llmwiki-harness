/**
 * root.ts — 볼트 루트 결정·검증 (P2-03, P2-19; codex 2차 BLOCKER-1·MAJOR-5).
 *
 * 서버·`--selftest`·`--once` 가 **같은** 함수를 쓴다. 규칙:
 * 1. `--root` → `LLMWIKI_ROOT` → 오류.
 * 2. root 는 `realpath` 로 정규화(디렉터리여야 함).
 * 3. `<root>/wiki` 는 디렉터리이고 **심볼릭 링크가 아니어야** 하며(`lstat`), 그 realpath 가 정확히 `<rootReal>/wiki` 여야 한다.
 *    — `root/wiki → /tmp/outside` 링크면 walkMd 의 경계(`realpath(wiki)` 하위)가 외부를 내부로 승인하던 결함(codex 2차 BLOCKER-1).
 * 오류 메시지는 사용자가 넘긴 문자열만 반영하고 realpath 는 노출하지 않는다.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export class RootError extends Error {
  readonly exitCode = 2;
}

export async function resolveRoot(explicit: string | undefined): Promise<string> {
  const raw = explicit ?? process.env.LLMWIKI_ROOT;
  if (!raw) throw new RootError("vault root required: pass --root <path> or set LLMWIKI_ROOT");
  let real: string;
  try {
    real = await fs.realpath(raw);
    if (!(await fs.stat(real)).isDirectory()) throw new Error();
  } catch {
    throw new RootError(`vault root not found or not a directory: ${JSON.stringify(raw)}`);
  }
  const wiki = path.join(real, "wiki");
  let lst;
  try {
    lst = await fs.lstat(wiki);
  } catch {
    throw new RootError(`not an llmwiki vault (missing wiki/ directory): ${JSON.stringify(raw)}`);
  }
  if (lst.isSymbolicLink()) throw new RootError(`refusing vault whose wiki/ is a symbolic link: ${JSON.stringify(raw)}`);
  if (!lst.isDirectory()) throw new RootError(`not an llmwiki vault (wiki is not a directory): ${JSON.stringify(raw)}`);
  const wikiReal = await fs.realpath(wiki);
  if (path.relative(real, wikiReal) !== "wiki") throw new RootError(`refusing vault whose wiki/ resolves outside the root: ${JSON.stringify(raw)}`);
  return real;
}

/** 진단 출력용 — 절대 경로 대신 basename + 짧은 해시(codex 2차 #10). */
export async function rootLabel(real: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return `${path.basename(real)} (sha256:${createHash("sha256").update(real).digest("hex").slice(0, 8)})`;
}

/**
 * P2 외부 보안리뷰(2026-09-09) 수정 검증 — server.ts / vault.ts / cli.ts.
 *   동시 호출 세마포어 · 볼트 규모 상한(MAX_FILE_BYTES·MAX_FILES → VaultLimitError → isError) · read() O_NOFOLLOW
 *   · 경계 이탈 경고의 로그 주입 방지(JSON.stringify) · CLI argv 순서(--root 가 --once 앞 / print-config 위치 무관).
 * 각 it 제목은 리뷰 finding 을 그대로 적는다. CLI 검사는 dist/cli.js 를 spawn 한다(없으면 skip).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { MAX_CONCURRENT_CALLS, callTool } from "../../src/server.js";
import { MAX_FILES, MAX_FILE_BYTES, VaultLimitError, read, walkMd } from "../../src/vault.js";
import { DIST_CLI, FIXTURE_VAULT, connect, text } from "./p2-helpers.js";

const POSIX = process.platform !== "win32";
const tmpDirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("review: concurrency semaphore", () => {
  it("MAJOR: MAX_CONCURRENT_CALLS === 4 is exported", () => {
    expect(MAX_CONCURRENT_CALLS).toBe(4);
  });

  it("MAJOR: 12 concurrent wiki_expand calls over the MCP client all resolve, none isError, identical results", async () => {
    const c = await connect(FIXTURE_VAULT, { structured: true });
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () => c.call("wiki_expand", { terms: ["rerank", "bm25"], rerank: 11 })));
      expect(results).toHaveLength(12);
      for (const r of results) {
        expect(r.isError).toBeFalsy();
        expect(text(r).length).toBeGreaterThan(0);
      }
      const first = JSON.stringify(results[0].structuredContent);
      for (const r of results) expect(JSON.stringify(r.structuredContent)).toBe(first);
    } finally {
      await c.close();
    }
  });

  it("MAJOR: 12 concurrent direct callTool invocations (bypassing the transport) also all resolve — queue drains, no starvation", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => callTool(FIXTURE_VAULT, i % 2 ? "wiki_search" : "wiki_expand", { terms: ["rerank"] }, undefined, true)));
    for (const r of results) expect(r.isError).toBeFalsy();
    // 세마포어가 해제됐는지 — 이후 호출이 즉시 처리된다
    const after = await callTool(FIXTURE_VAULT, "wiki_read_page", { slug: "concept-reranking" }, undefined, true);
    expect(after.isError).toBeFalsy();
  });
});

describe("review: vault size limits", () => {
  it("MAJOR: constants — MAX_FILE_BYTES is 16 MiB and MAX_FILES is 20000", () => {
    expect(MAX_FILE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_FILES).toBe(20000);
  });

  it("MAJOR: a 17 MiB .md makes read() throw VaultLimitError and wiki_search / wiki_read_page return isError mentioning bytes", async () => {
    const root = await tmp("llmwiki-review-big-");
    const dir = path.join(root, "wiki", "L3-semantic");
    await mkdir(dir, { recursive: true });
    const huge = path.join(dir, "huge.md");
    await writeFile(huge, Buffer.alloc(17 * 1024 * 1024, 0x78)); // 17 MiB of 'x'
    await writeFile(path.join(dir, "small.md"), "---\ntype: concept\n---\n# small\nrerank\n", "utf8");
    await expect(read(huge)).rejects.toBeInstanceOf(VaultLimitError);
    await expect(read(huge)).rejects.toThrow(/bytes/);
    const s = await callTool(root, "wiki_search", { terms: ["rerank"] }, undefined, true);
    expect(s.isError).toBe(true);
    expect(text(s)).toMatch(/exceeds \d+ bytes/);
    expect(text(s)).not.toContain(root); // 경로 누설 없이 basename 만
    const p = await callTool(root, "wiki_read_page", { slug: "huge" }, undefined, true);
    expect(p.isError).toBe(true);
    expect(text(p)).toMatch(/bytes/);
    // 같은 오류가 MCP 와이어에서도 isError 로(throw 아님)
    const c = await connect(root, { structured: true });
    try {
      const r = await c.call("wiki_expand", { terms: ["rerank"] });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/bytes/);
    } finally {
      await c.close();
    }
  });

  it("MAJOR: walkMd throws VaultLimitError once more than MAX_FILES markdown files are found (20001 files)", async () => {
    const root = await tmp("llmwiki-review-many-");
    const wiki = path.join(root, "wiki");
    await mkdir(wiki);
    const N = MAX_FILES + 1;
    const BATCH = 250;
    for (let i = 0; i < N; i += BATCH) {
      await Promise.all(Array.from({ length: Math.min(BATCH, N - i) }, (_, j) => writeFile(path.join(wiki, `p${i + j}.md`), "x")));
    }
    await expect(walkMd(wiki)).rejects.toBeInstanceOf(VaultLimitError);
    await expect(walkMd(wiki)).rejects.toThrow(/exceeds 20000 markdown files/);
    const r = await callTool(root, "wiki_search", { terms: ["x"] }, undefined, true);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/exceeds 20000/);
  }, 60_000);
});

describe("review: read() opens with O_NOFOLLOW (POSIX)", () => {
  it.skipIf(!POSIX)("BLOCKER (TOCTOU): read(symlinkPath) returns '' (ELOOP → Python-parity empty string) while the real file reads normally", async () => {
    const d = await tmp("llmwiki-review-nofollow-");
    const real = path.join(d, "real.md");
    const link = path.join(d, "link.md");
    await writeFile(real, "secret body\n", "utf8");
    await symlink(real, link);
    expect(await read(real)).toBe("secret body\n");
    expect(await read(link)).toBe("");
    // 링크 대상이 볼트 밖이든 안이든 링크 자체를 따라가지 않는다
    const outside = await tmp("llmwiki-review-outside-");
    const secret = path.join(outside, "secret.md");
    await writeFile(secret, "outside secret\n", "utf8");
    const link2 = path.join(d, "link2.md");
    await symlink(secret, link2);
    expect(await read(link2)).toBe("");
  });

  it("read() of a missing path is '' (unchanged Python parity) — only the limit error is surfaced", async () => {
    expect(await read(path.join(os.tmpdir(), "llmwiki-review-does-not-exist.md"))).toBe("");
  });
});

describe("review: boundary-skip warning is log-injection safe", () => {
  // 경계 이탈 경고는 realpath 가 실패하거나 볼트 밖을 가리킬 때 난다. 심볼릭 링크 엔트리는 walk 가 먼저 건너뛰므로,
  // 읽기(r)는 되지만 탐색(x)이 안 되는 디렉터리를 만들어 readdir 은 성공·realpath 는 EACCES 로 실패하게 한다.
  // root 로 실행되면 권한이 무시돼 재현되지 않는다 → skip.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(!POSIX || asRoot)("MINOR: a file name containing a newline and a fake '[llmwiki]' prefix is JSON.stringify-escaped in the stderr warning", async () => {
    const root = await tmp("llmwiki-review-loginj-");
    const wiki = path.join(root, "wiki");
    const sub = path.join(wiki, "sub");
    await mkdir(sub, { recursive: true });
    const evil = "evil\n[llmwiki] ready\u001b[0m.md";
    await writeFile(path.join(sub, evil), "x", "utf8");
    await writeFile(path.join(wiki, "ok.md"), "x", "utf8");
    await chmod(sub, 0o444);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const captured = async (): Promise<{ files: string[]; msgs: string[] }> => {
      try {
        const files = (await walkMd(wiki)).map((f) => f.slug);
        return { files, msgs: spy.mock.calls.map((c) => String(c[0])) }; // mockRestore 가 기록을 지우므로 먼저 복사
      } finally {
        spy.mockRestore();
        await chmod(sub, 0o755);
      }
    };
    const { files, msgs } = await captured();
    expect(files).toEqual(["ok"]);
    const warn = msgs.filter((m) => m.includes("outside wiki boundary"));
    expect(warn).toHaveLength(1);
    // 한 줄짜리 메시지: 내부 개행·ESC 는 이스케이프돼 있고 원문 제어문자는 없다
    expect(warn[0].endsWith("\n")).toBe(true);
    const rawCtrl = ["\n", "\r", "\u001b"].filter((ch) => warn[0].slice(0, -1).includes(ch));
    expect(rawCtrl).toEqual([]); // 원문 제어문자(개행·CR·ESC)가 남아있지 않다
    expect(warn[0]).toContain(JSON.stringify(path.join("sub", evil)));
    expect(warn[0].split("\n")).toHaveLength(2); // 본문 1줄 + 마지막 개행
    expect(warn[0]).not.toContain("\n[llmwiki] ready"); // 가짜 2번째 로그 줄이 생기지 않는다
  });
});

describe("review: CLI argv order", () => {
  const HAVE_DIST = existsSync(DIST_CLI);
  function cleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.LLMWIKI_ROOT;
    delete env.LLMWIKI_DEBUG;
    return env;
  }
  function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, [DIST_CLI, ...args], { encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it.skipIf(!HAVE_DIST)("MAJOR: `--root <vault> --once search rerank` produces the same stdout as `--once search rerank --root <vault>` (root before --once was lost)", () => {
    const a = run(["--root", FIXTURE_VAULT, "--once", "search", "rerank"]);
    const b = run(["--once", "search", "rerank", "--root", FIXTURE_VAULT]);
    expect(a.status, a.stderr).toBe(0);
    expect(b.status, b.stderr).toBe(0);
    expect(a.stdout.length).toBeGreaterThan(0);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout).toContain("concept-reranking");
    // expand/pack 도 같은 규칙
    const e1 = run(["--root", FIXTURE_VAULT, "--once", "expand", "rerank", "--max", "5"]);
    const e2 = run(["--once", "expand", "rerank", "--max", "5", "--root", FIXTURE_VAULT]);
    expect(e1.status).toBe(0);
    expect(e1.stdout).toBe(e2.stdout);
  });

  it.skipIf(!HAVE_DIST)("MINOR: `--global print-config --client agy --root /tmp/v` exits 0 (subcommand may appear anywhere)", () => {
    const r = run(["--global", "print-config", "--client", "agy", "--root", "/tmp/v"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("agy mcp add llmwiki -- llmwiki-mcp --root /tmp/v");
    expect(r.stdout).not.toContain("npx");
    // print-config 는 root 존재를 검증하지 않는다(/tmp/v 없어도 exit 0). Windows CLI 형은 cmdq 인용이지만 `cmd`·`/c` 는
    // 안전 집합(`/` 포함)이라 인용 없이 `cmd /c …` 로 찍힌다 — 인용은 경로가 실리는 `--env` 값에만 걸린다.
    const w = run(["--windows", "--client", "claude-code", "print-config", "--root", "C:\\wiki\\safe&whoami"]);
    expect(w.status, w.stderr).toBe(0);
    expect(w.stdout).not.toContain("--root");
    expect(w.stdout).toContain(" -- cmd /c npx -y obsidian-llmwiki-mcp\n");
    expect(w.stdout).toContain('--env "LLMWIKI_ROOT=C:\\wiki\\safe&whoami" llmwiki -- ');
  });

  it.skipIf(!HAVE_DIST)("BLOCKER: `--name 'x; whoami'` exits non-zero with the reason on stderr and nothing on stdout", () => {
    const r = run(["print-config", "--client", "agy", "--root", "/tmp/v", "--name", "x; whoami"]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/invalid server name/);
    const nl = run(["print-config", "--client", "codex", "--root", "/tmp/v\nevil"]);
    expect(nl.status).not.toBe(0);
    expect(nl.stdout).toBe("");
    expect(nl.stderr).toMatch(/newline or NUL/);
  });
});

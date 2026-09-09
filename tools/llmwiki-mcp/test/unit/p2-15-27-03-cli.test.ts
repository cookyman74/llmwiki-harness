/**
 * P2-15 stdout 순수성 · P2-27 --version/--help/exit code · P2-03 root 결정/--selftest (DESIGN §3.5, §5 로그).
 * 실제 `node dist/cli.js` 를 spawn 한다 — dist/cli.js 가 없으면(빌드 전) 사유를 남기고 skip.
 * 환경변수 LLMWIKI_ROOT / LLMWIKI_DEBUG 는 제거해 기본 quiet 경로를 검사한다.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DIST_CLI, FIXTURE_VAULT, PKG_DIR } from "./p2-helpers.js";

const HAVE_DIST = existsSync(DIST_CLI);
const PKG_VERSION = (JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8")) as { version: string }).version;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LLMWIKI_ROOT;
  delete env.LLMWIKI_DEBUG;
  return env;
}

function run(args: string[], env: NodeJS.ProcessEnv = cleanEnv()): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [DIST_CLI, ...args], { encoding: "utf8", env, timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function skip(): boolean {
  if (!HAVE_DIST) {
    // eslint-disable-next-line no-console
    console.error(`SKIP: ${DIST_CLI} not found — run \`npm run build\` first`);
    return true;
  }
  return false;
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 서버를 띄워 JSON-RPC 요청을 보내고 stdout 을 N줄 모을 때까지 기다린 뒤 종료한다. */
async function driveServer(args: string[], requests: object[], wantLines: number, env = cleanEnv()): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_CLI, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const finish = (e?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      if (e) reject(e);
      else resolve({ stdout: out, stderr: err });
    };
    const timer = setTimeout(() => finish(new Error(`server timeout; stdout so far: ${JSON.stringify(out)} stderr: ${JSON.stringify(err)}`)), 20_000);
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString("utf8");
      const complete = out.split("\n").length - 1; // 완결된(개행으로 끝난) 줄 수
      if (complete >= wantLines) finish();
    });
    child.stderr.on("data", (b: Buffer) => {
      err += b.toString("utf8");
    });
    child.on("error", (e) => finish(e));
    child.on("exit", (code) => {
      if (!done) finish(new Error(`server exited early (code ${code}); stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`));
    });
    for (const req of requests) child.stdin.write(`${JSON.stringify(req)}\n`);
  });
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p2-stdout", version: "0" } } };
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const CALL = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wiki_search", arguments: { terms: ["rerank"] } } };

describe("P2-15 stdout purity", () => {
  it("P2-15 서버 기동 후 stdout 첫 바이트는 '{' 이고 모든 stdout 줄이 JSON-RPC 이다 (기본 quiet: stderr 비어있음)", async () => {
    if (skip()) return;
    const { stdout, stderr } = await driveServer(["--root", FIXTURE_VAULT], [INIT, INITIALIZED, LIST, CALL], 3);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout[0]).toBe("{");
    expect(stdout.charCodeAt(0)).not.toBe(0xfeff);
    const lines = stdout.split("\n").filter((ln) => ln.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const msgs = lines.map((ln) => {
      expect(ln[0]).toBe("{");
      return JSON.parse(ln) as { jsonrpc: string; id?: number; result?: Record<string, unknown> };
    });
    for (const m of msgs) expect(m.jsonrpc).toBe("2.0");
    const byId = new Map(msgs.map((m) => [m.id, m]));
    expect((byId.get(1)?.result?.serverInfo as { name: string }).name).toBe("llmwiki");
    expect(typeof byId.get(1)?.result?.instructions).toBe("string");
    expect((byId.get(2)?.result?.tools as unknown[]).length).toBe(4);
    expect(((byId.get(3)?.result?.content as { text: string }[])[0].text as string).length).toBeGreaterThan(0);
    expect(stderr).toBe("");
  });

  it("P2-15 / P2-04 LLMWIKI_DEBUG=1 이면 stderr 에 도구별 소요(ms)만 — 질의어·내용 미포함, stdout 은 여전히 순수", async () => {
    if (skip()) return;
    const { stdout, stderr } = await driveServer(["--root", FIXTURE_VAULT], [INIT, INITIALIZED, LIST, CALL], 3, { ...cleanEnv(), LLMWIKI_DEBUG: "1" });
    for (const ln of stdout.split("\n").filter((x) => x.length)) expect(ln[0]).toBe("{");
    expect(stderr).toMatch(/\[llmwiki\] wiki_search \d+ms/);
    expect(stderr).not.toContain("rerank"); // 질의어 금지
    expect(stderr).not.toContain("concept-"); // 결과 내용 금지
  });

  it("P2-15 --selftest 와 --version 은 성공 시 stderr 에 아무것도 쓰지 않는다", () => {
    if (skip()) return;
    const v = run(["--version"]);
    expect(v.status).toBe(0);
    expect(v.stderr).toBe("");
    const s = run(["--selftest", "--root", FIXTURE_VAULT]);
    expect(s.status).toBe(0);
    expect(s.stderr).toBe("");
  });
});

describe("P2-27 CLI --help / --version / exit codes", () => {
  it("P2-27 --help → exit 0, print-config 와 --once 언급, stderr 없음", () => {
    if (skip()) return;
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("print-config");
    expect(r.stdout).toContain("--once");
    expect(r.stdout).toContain("--selftest");
    expect(r.stdout).toContain("LLMWIKI_ROOT");
    expect(r.stdout).toContain(`llmwiki-mcp ${PKG_VERSION}`);
    for (const cname of ["claude-code", "codex", "gemini", "agy", "cursor", "windsurf", "claude-desktop", "vscode"]) expect(r.stdout).toContain(cname);
    expect(run(["-h"]).stdout).toBe(r.stdout);
  });

  it("P2-27 --version → '<package.json version>\\n' (현재 0.1.0)", () => {
    if (skip()) return;
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${PKG_VERSION}\n`);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("P2-27 root 없음(--root 도 LLMWIKI_ROOT 도 없음) → exit 2 + stderr 메시지, stdout 비움", () => {
    if (skip()) return;
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/--root|LLMWIKI_ROOT/);
  });

  it("P2-27 --root /nonexistent → exit 2", () => {
    if (skip()) return;
    const r = run(["--root", path.join(os.tmpdir(), "llmwiki-p2-does-not-exist-" + process.pid)]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/not found/);
  });

  it("P2-27 print-config --client bogus --root x → exit 2 + 허용 목록 안내", () => {
    if (skip()) return;
    const r = run(["print-config", "--client", "bogus", "--root", "x"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("--client must be one of");
    expect(r.stderr).toContain("claude-code");
    const noRoot = run(["print-config", "--client", "cursor"]);
    expect(noRoot.status).toBe(2);
    expect(noRoot.stderr).toMatch(/--root/);
  });

  it("P2-27 print-config 는 파일을 쓰지 않고 stdout 에만 출력한다 (--root 는 존재하지 않아도 됨)", () => {
    if (skip()) return;
    const r = run(["print-config", "--client", "claude-code", "--root", "/nonexistent/vault"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("claude mcp add --scope user llmwiki -- npx -y llmwiki-mcp --root /nonexistent/vault");
  });

  it("P2-27 알 수 없는 위치 인자 → exit 2", () => {
    if (skip()) return;
    const r = run(["bogus-subcommand", "--root", FIXTURE_VAULT]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unexpected argument");
  });
});

describe("P2-03 root resolution / --selftest", () => {
  it("P2-03 --selftest --root <fixture> → exit 0, pages: 26 / mocs: 3 / buildGraph_ms / startup_to_ready_ms", () => {
    if (skip()) return;
    const r = run(["--selftest", "--root", FIXTURE_VAULT]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const lines = r.stdout.split("\n");
    expect(lines[0]).toBe(`llmwiki-mcp ${PKG_VERSION} selftest`);
    // codex 2차 #10: 절대 경로 대신 basename + sha256[:8]. 전체 경로는 --show-root 로만.
    const label = `${path.basename(FIXTURE_VAULT)} (sha256:${createHash("sha256").update(FIXTURE_VAULT).digest("hex").slice(0, 8)})`;
    expect(lines).toContain(`root: ${label}`);
    expect(lines[1]).toMatch(/^root: [^/\\]+ \(sha256:[0-9a-f]{8}\)$/);
    expect(r.stdout).not.toContain(FIXTURE_VAULT);
    const shown = run(["--selftest", "--root", FIXTURE_VAULT, "--show-root"]);
    expect(shown.status).toBe(0);
    expect(shown.stdout.split("\n")).toContain(`root: ${FIXTURE_VAULT}`);
    // 픽스처는 .md 26개지만 dup-note.md 가 L2·L3 에 중복(마지막 승 픽스처) → 그래프 노드 = 고유 slug 25 (selftest 는 G.nodes.size)
    expect(lines).toContain("pages: 25");
    expect(lines).toContain("mocs: 3");
    expect(r.stdout).toMatch(/^buildGraph_ms: \d+$/m);
    expect(r.stdout).toMatch(/^startup_to_ready_ms: \d+$/m);
    expect(r.stdout.endsWith("\n")).toBe(true);
  });

  it("P2-03 LLMWIKI_ROOT 환경변수로도 root 결정 (--root 우선)", () => {
    if (skip()) return;
    const viaEnv = run(["--selftest"], { ...cleanEnv(), LLMWIKI_ROOT: FIXTURE_VAULT });
    expect(viaEnv.status).toBe(0);
    expect(viaEnv.stdout).toContain("pages: 25");
    const bad = mkdtempSync(path.join(os.tmpdir(), "llmwiki-p2-nowiki-"));
    tmpDirs.push(bad);
    const flagWins = run(["--selftest", "--root", FIXTURE_VAULT], { ...cleanEnv(), LLMWIKI_ROOT: bad });
    expect(flagWins.status).toBe(0);
    expect(flagWins.stdout).toContain("pages: 25");
  });

  it("P2-03 wiki/ 디렉터리가 없는 root → exit 2 + stderr 1줄", () => {
    if (skip()) return;
    const bad = mkdtempSync(path.join(os.tmpdir(), "llmwiki-p2-nowiki-"));
    tmpDirs.push(bad);
    const r = run(["--root", bad]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/missing wiki\//);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    const s = run(["--selftest", "--root", bad]);
    expect(s.status).toBe(2);
  });
});

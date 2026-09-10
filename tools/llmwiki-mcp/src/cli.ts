#!/usr/bin/env node
/**
 * cli.ts — 진입점 (DESIGN §3.5; P2-03, P2-19, P2-24, P2-25, P2-27).
 *
 *   llmwiki-mcp --root <vault>                 MCP stdio 서버 기동 (root: --root → LLMWIKI_ROOT → 오류 exit 2)
 *   llmwiki-mcp --selftest [--root <vault>]    페이지 수·MoC 수·buildGraph(ms)·기동→ready(ms) 출력 후 종료
 *   llmwiki-mcp print-config --client <name> --root <vault> [--windows] [--global] [--name <server>]
 *   llmwiki-mcp --once <search|expand|pack> …  Python 스크립트와 동일 출력 1회 실행(패리티·디버그). root 검증은 서버와 동일.
 *   llmwiki-mcp --version | --help
 * stdout 은 서버 모드에서 JSON-RPC 전용. 진단은 stderr.
 * 서브커맨드 우선순위(agy 2차 MINOR-4): `print-config` 가 argv 어디에든 있으면 print-config 모드, 그다음 `--once`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./graph.js";
import { ArgError, UsageError, parseArgs, runOnce } from "./once.js";
import { CLIENTS, PrintConfigError, isClientName, printConfig } from "./print-config.js";
import { RootError, resolveRoot, rootLabel } from "./root.js";
import { startStdio } from "./server.js";
import { VaultLimitError } from "./vault.js";

const T_START = Date.now();

function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

const HELP = `llmwiki-mcp ${"%v"} — read-only MCP server over an llmwiki Obsidian vault

Usage:
  llmwiki-mcp --root <vault>                       start MCP stdio server (or set LLMWIKI_ROOT)
  llmwiki-mcp --selftest [--root <vault>] [--show-root]   print page/MoC counts and timings, then exit
  llmwiki-mcp print-config --client <c> --root <vault> [--windows] [--global] [--name <server>]
        <c> = ${CLIENTS.join(" | ")}
  llmwiki-mcp --once <search|expand|pack> <args…> --root <vault>   (same output as the Python scripts)
  llmwiki-mcp --version | --help
Env: LLMWIKI_ROOT (vault path), LLMWIKI_DEBUG=1 (per-tool timings on stderr)
`;

async function selftest(root: string, showRoot: boolean): Promise<string> {
  const t0 = Date.now();
  const G = await buildGraph(path.join(root, "wiki"));
  const build = Date.now() - t0;
  let mocs = 0;
  for (const n of G.nodes.values()) if (n.type === "moc") mocs++;
  const label = showRoot ? root : await rootLabel(root); // 기본은 basename+해시(codex 2차 #10), --show-root 로 전체 경로
  return `llmwiki-mcp ${version()} selftest\nroot: ${label}\npages: ${G.nodes.size}\nmocs: ${mocs}\nbuildGraph_ms: ${build}\nstartup_to_ready_ms: ${Date.now() - T_START}\n`;
}

/** print-config 인자 파싱 — 값을 받는 옵션 뒤 토큰은 플래그로 오인하지 않는다(agy 2차 MINOR-4). */
function parsePrintConfig(argv: string[]): { client?: string; root?: string; name?: string; windows: boolean; global: boolean } {
  const out: { client?: string; root?: string; name?: string; windows: boolean; global: boolean } = { windows: false, global: false };
  const valued: Record<string, "client" | "root" | "name"> = { "--client": "client", "--root": "root", "--name": "name" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "print-config") continue;
    if (a in valued) {
      if (i + 1 >= argv.length) throw new ArgError(`option ${a} requires a value`);
      out[valued[a]] = argv[++i];
    } else if (a === "--windows") out.windows = true;
    else if (a === "--global") out.global = true;
    else throw new ArgError(`unexpected argument: ${a}`);
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--version")) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP.replace("%v", version()));
    return 0;
  }
  try {
    if (argv.includes("print-config")) {
      const pc = parsePrintConfig(argv);
      if (!pc.client || !isClientName(pc.client)) throw new ArgError(`--client must be one of: ${CLIENTS.join(", ")}`);
      const root = pc.root ?? process.env.LLMWIKI_ROOT;
      if (!root) throw new ArgError("--root <vault> required (or LLMWIKI_ROOT)");
      process.stdout.write(printConfig({ client: pc.client, root, windows: pc.windows, global: pc.global, name: pc.name }));
      return 0;
    }
    const onceAt = argv.indexOf("--once");
    if (onceAt >= 0) {
      const mode = argv[onceAt + 1];
      if (mode !== "search" && mode !== "expand" && mode !== "pack") {
        process.stderr.write("usage: llmwiki-mcp --once <search|expand|pack> [args…] --root <vault>\n");
        return 2;
      }
      // `--once <mode>` 앞뒤 인자를 모두 전달(agy 1차 MAJOR-1). root 는 서버와 같은 resolveRoot 를 거친다(codex 2차 #5).
      const rest = [...argv.slice(0, onceAt), ...argv.slice(onceAt + 2)];
      const { opts, positional } = parseArgs(rest, { "--root": "root", "--top": "top", "--top-seed": "topSeed", "--max": "max", "--rerank": "rerank" });
      const root = await resolveRoot(opts.root);
      const forwarded: string[] = [...positional];
      for (const [flag, key] of Object.entries({ "--top": "top", "--top-seed": "topSeed", "--max": "max", "--rerank": "rerank" })) {
        if (opts[key] !== undefined) forwarded.push(flag, opts[key]);
      }
      process.stdout.write(await runOnce(mode, [...forwarded, "--root", root]));
      return 0;
    }
    const { opts, positional } = parseArgs(argv.filter((a) => a !== "--selftest" && a !== "--show-root"), { "--root": "root" });
    if (positional.length) throw new ArgError(`unexpected argument: ${positional[0]} (see --help)`);
    const root = await resolveRoot(opts.root);
    if (argv.includes("--selftest")) {
      process.stdout.write(await selftest(root, argv.includes("--show-root")));
      return 0;
    }
    await startStdio({ root, version: version(), debug: process.env.LLMWIKI_DEBUG === "1" });
    return -1; // 서버 모드: 종료하지 않음
  } catch (e) {
    if (e instanceof UsageError || e instanceof ArgError || e instanceof RootError || e instanceof PrintConfigError) {
      process.stderr.write(`${e.message}\n`);
      return e instanceof UsageError || e instanceof RootError ? e.exitCode : e instanceof ArgError ? 2 : 2;
    }
    if (e instanceof VaultLimitError) {
      process.stderr.write(`${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`llmwiki-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);

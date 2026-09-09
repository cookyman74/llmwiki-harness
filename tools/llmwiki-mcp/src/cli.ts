#!/usr/bin/env node
/**
 * cli.ts — 진입점. P1 범위: `--version`, `--once <search|expand|pack> …`(서버 없이 1회 실행, Python stdout 과 바이트 동일).
 * 인자 규약은 Python 스크립트와 같다:
 *   --once search <term…> --root R [--top N]                           (search.py --files)
 *   --once expand <term…> --root R [--top-seed N] [--max N] [--rerank N] (scope-expand.py expand)
 *   --once pack <slug…> --root R                                        (scope-expand.py pack)
 * MCP 서버 기동(P2)은 아직 없음 — 안내 후 exit 2. stdout 은 결과 텍스트 전용, 진단은 stderr.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ArgError, UsageError, runOnce } from "./once.js";

function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--version")) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  const i = argv.indexOf("--once");
  if (i >= 0) {
    const mode = argv[i + 1];
    const rest = argv.slice(i + 2);
    if (mode !== "search" && mode !== "expand" && mode !== "pack") {
      process.stderr.write("usage: llmwiki-mcp --once <search|expand|pack> [args…] --root <vault>\n");
      return 2;
    }
    try {
      process.stdout.write(await runOnce(mode, rest));
      return 0;
    } catch (e) {
      if (e instanceof UsageError || e instanceof ArgError) {
        process.stderr.write(`${e.message}\n`);
        return e.exitCode;
      }
      throw e;
    }
  }
  process.stderr.write("llmwiki-mcp: MCP server not implemented yet (P1 — use --once or --version)\n");
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`llmwiki-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);

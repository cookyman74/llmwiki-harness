#!/usr/bin/env node
/** DESIGN.md §2 — cli.ts: argument parsing (--root/--version/--selftest/--once/print-config) → server startup (P0 stub). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function version(): string {
  // dist/cli.js → ../package.json (package root)
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write(`${version()}\n`);
  process.exit(0);
}

process.stderr.write("llmwiki-mcp: not implemented yet (P0 scaffold)\n");
process.exit(2);

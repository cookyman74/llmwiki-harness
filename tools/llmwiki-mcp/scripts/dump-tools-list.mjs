/**
 * dump-tools-list.mjs — `develop_docs/v0.8.6/todo/review/P2-tools-list.json` 재생성 (P3-27+).
 *
 * 이 덤프는 외부리뷰 증거물이자 `test/unit/p3-ajv-cross-check.test.ts` 의 비교 기준이다. 도구 이름·description·
 * inputSchema·outputSchema·instructions 가 바뀌면 이 스크립트로 다시 뜬다.
 *
 *   cd tools/llmwiki-mcp && npm run build && node scripts/dump-tools-list.mjs
 *
 * 옵션: `--check` 는 파일을 쓰지 않고 현재 파일과 다른지만 알린다(다르면 exit 1).
 * MCP 서버를 띄우지 않고 `dist/tools.js`(= tools/list 가 그대로 내보내는 값)에서 직접 읽는다 — 서버는
 * `TOOLS.map(t => ({name, description, inputSchema, outputSchema}))` 을 손대지 않고 전달한다(src/server.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.join(HERE, "..");
const OUT = path.join(PKG_DIR, "..", "..", "develop_docs", "v0.8.6", "todo", "review", "P2-tools-list.json");

const { TOOLS, SERVER_INSTRUCTIONS } = await import(path.join(PKG_DIR, "dist", "tools.js"));

const dump = {
  instructions: SERVER_INSTRUCTIONS,
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema })),
};
const text = `${JSON.stringify(dump, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    current = "";
  }
  // 도구 순서는 캡처 시점(MCP Inspector) 순서일 수 있으므로 순서 무시 비교
  const norm = (s) => {
    const d = JSON.parse(s);
    d.tools.sort((a, b) => (a.name < b.name ? -1 : 1));
    return JSON.stringify(d);
  };
  const same = current !== "" && norm(current) === norm(text);
  process.stderr.write(same ? "P2-tools-list.json is current\n" : "P2-tools-list.json differs from the live TOOLS — rerun without --check\n");
  process.exit(same ? 0 : 1);
}

writeFileSync(OUT, text);
process.stderr.write(`wrote ${OUT} (${dump.tools.length} tools)\n`);

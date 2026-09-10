/**
 * stage-bench.mjs — expand 호출의 **단계별 인프로세스 측정** (P4-01 착수 판정 / P4-12+ 검증용).
 *
 *   node test/perf/stage-bench.mjs <vault-root> <term> [term ...] [--runs 30]
 *
 * `bench.py` 는 프로세스 wall 을 재기 때문에 node 부팅(~145ms)과 파일 IO 가 신호를 덮는다.
 * 여기서는 그래프를 한 번 만든 뒤 단계(buildGraph · lex · bm25)만 반복 측정한다.
 *   - lex.legacy : Python 정본 구조(= lexicalSeeds 와 expand 가 각자 전 노드 lex_score)
 *   - lex.shared : P4-12+ 공유 인덱스(호출당 1회)
 * 두 경로의 결과가 동일한지(identical)도 같이 확인한다.
 *
 * 출력에는 slug·본문을 싣지 않는다(숫자만) — baseline/ 에 그대로 붙여도 볼트 내용이 새지 않는다.
 */
import path from "node:path";
import { bm25Rank } from "../../dist/bm25.js";
import { expand, lexIndex, lexicalSeeds } from "../../dist/expand.js";
import { buildGraph } from "../../dist/graph.js";
import { normalizeTerms } from "../../dist/search.js";

const argv = process.argv.slice(2);
const runsIdx = argv.indexOf("--runs");
const RUNS = runsIdx >= 0 ? Number(argv[runsIdx + 1]) : 30;
const rest = runsIdx >= 0 ? [...argv.slice(0, runsIdx), ...argv.slice(runsIdx + 2)] : argv;
const [root, ...terms] = rest;
if (!root || terms.length === 0) {
  console.error("usage: node stage-bench.mjs <vault-root> <term> [term ...] [--runs N]");
  process.exit(2);
}

const WARM = 5;
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timeAsync(fn) {
  const xs = [];
  for (let i = 0; i < RUNS + WARM; i++) {
    const t = performance.now();
    await fn();
    if (i >= WARM) xs.push(performance.now() - t);
  }
  return med(xs);
}
function time(fn) {
  const xs = [];
  for (let i = 0; i < RUNS + WARM; i++) {
    const t = performance.now();
    fn();
    if (i >= WARM) xs.push(performance.now() - t);
  }
  return med(xs);
}

const base = path.join(root, "wiki");
const G = await buildGraph(base);
const tl = normalizeTerms(terms);

const tBuild = await timeAsync(() => buildGraph(base));
const tLegacy = time(() => {
  const seeds = lexicalSeeds(G, tl, 6);
  expand(G, tl, seeds, 15);
});
const tShared = time(() => {
  const idx = lexIndex(G, tl);
  const seeds = lexicalSeeds(G, tl, 6, idx);
  expand(G, tl, seeds, 15, idx);
});

const idx = lexIndex(G, tl);
const rows = expand(G, tl, lexicalSeeds(G, tl, 6, idx), 15, idx);
const pool = rows.map((r) => r.slug);
const tBm25 = pool.length ? time(() => bm25Rank(G, tl, pool)) : 0;

const legacyOut = JSON.stringify(expand(G, tl, lexicalSeeds(G, tl, 6), 15));
const identical = legacyOut === JSON.stringify(rows);
const f = (x) => x.toFixed(2).padStart(8);

console.log(`pages=${G.nodes.size} terms=${tl.length} rows=${rows.length} runs=${RUNS} (median ms)`);
console.log(`  buildGraph        ${f(tBuild)}`);
console.log(`  lex.legacy(2패스) ${f(tLegacy)}`);
console.log(`  lex.shared(1패스) ${f(tShared)}   delta=${(tLegacy - tShared).toFixed(2)} (${((100 * (tLegacy - tShared)) / tLegacy).toFixed(1)}%)`);
console.log(`  bm25Rank          ${f(tBm25)}`);
console.log(`  call total (shared+bm25+build) ${f(tBuild + tShared + tBm25)}   identical_output=${identical}`);

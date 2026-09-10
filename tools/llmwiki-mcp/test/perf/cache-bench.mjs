/**
 * cache-bench.mjs — 프로세스 내 mtime 캐시의 효과 측정 (P4-09).
 *
 *   node test/perf/cache-bench.mjs <vault-root> <term> [term ...] [--runs 10]
 *
 * 서버는 장수 프로세스라 **같은 프로세스 안의 2회차 호출**이 실제 사용 조건이다. CLI 로는 잴 수 없어
 * (프로세스마다 캐시가 새로 생긴다) 여기서 인프로세스로 잰다:
 *   off      : LLMWIKI_CACHE=0 — 캐시 경로를 타지 않는 기준선
 *   cold     : 캐시 on, 캐시를 비운 직후 1회차(스냅샷 stat 스캔 비용이 더해진다)
 *   warm     : 캐시 on, 스냅샷이 같은 2회차 이후
 *   stat scan: walkMd + snapshot 만 — warm 호출이 매번 치르는 고정 비용
 * 출력은 숫자만 — baseline/ 에 붙여도 볼트 내용이 새지 않는다.
 */
import path from "node:path";
import { resetCache, snapshot } from "../../dist/cache.js";
import { runExpand } from "../../dist/once.js";
import { walkMd } from "../../dist/vault.js";

const argv = process.argv.slice(2);
const ri = argv.indexOf("--runs");
const RUNS = ri >= 0 ? Number(argv[ri + 1]) : 10;
const rest = ri >= 0 ? [...argv.slice(0, ri), ...argv.slice(ri + 2)] : argv;
const [root, ...terms] = rest;
if (!root || terms.length === 0) {
  console.error("usage: node cache-bench.mjs <vault-root> <term> [term ...] [--runs N]");
  process.exit(2);
}
const opts = { root, topSeed: 6, max: 15, rerank: 11 };
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timed(fn) {
  const t = performance.now();
  const v = await fn();
  return [performance.now() - t, v];
}

// off — 캐시를 타지 않는 기준선
process.env.LLMWIKI_CACHE = "0";
resetCache();
const offs = [];
let offOut = null;
for (let i = 0; i < RUNS; i++) {
  const [ms, out] = await timed(() => runExpand(terms, opts));
  if (i > 0) offs.push(ms);
  offOut = out;
}

// cold — 매 회 캐시를 비우고 1회차만 측정
delete process.env.LLMWIKI_CACHE;
const colds = [];
for (let i = 0; i < RUNS; i++) {
  resetCache();
  const [ms] = await timed(() => runExpand(terms, opts));
  colds.push(ms);
}

// warm — 캐시를 채운 뒤 반복
resetCache();
await runExpand(terms, opts);
const warms = [];
let warmOut = null;
for (let i = 0; i < RUNS; i++) {
  const [ms, out] = await timed(() => runExpand(terms, opts));
  warms.push(ms);
  warmOut = out;
}

// stat 스캔 단독(walkMd + snapshot) — warm 이 매번 치르는 고정 비용
const base = path.join(root, "wiki");
const scans = [];
for (let i = 0; i < RUNS; i++) {
  const [ms] = await timed(async () => snapshot(base, await walkMd(base)));
  scans.push(ms);
}

const f = (x) => x.toFixed(1).padStart(8);
console.log(`root_pages=${(await walkMd(base)).length} terms=${terms.length} runs=${RUNS} (median ms, 인프로세스)`);
console.log(`  off (LLMWIKI_CACHE=0) ${f(med(offs))}`);
console.log(`  cold (1회차)          ${f(med(colds))}`);
console.log(`  warm (2회차 이후)     ${f(med(warms))}   = off 대비 ${(100 * (1 - med(warms) / med(offs))).toFixed(1)}% 절감`);
console.log(`  stat scan (walk+stat) ${f(med(scans))}`);
console.log(`  identical_output=${offOut === warmOut}`);

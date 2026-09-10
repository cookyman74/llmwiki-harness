/**
 * format.ts — Python stdout 과 바이트 동일한 텍스트 렌더러 (DESIGN §3 공통 "동일성의 정의").
 * 모든 결과는 `\n` 으로 끝난다(Python print). rerank 점수는 fmt1(Python `.1f`).
 */
import type { Graph } from "./graph.js";
import type { ExpandRow } from "./expand.js";
import { TIER_NAME } from "./expand.js";
import type { PackPage } from "./pack.js";
import type { SearchRow } from "./search.js";
import { fmt1 } from "./vault.js";

/** search.py files_mode: 미매치는 `no matches for: <소문자화 terms>`, 아니면 `distinct/total\tslug\ttype`. */
export function renderSearch(terms: string[], rows: SearchRow[], matched: number = rows.length): string {
  if (matched === 0) return `no matches for: ${terms.join(" ")}\n`; // Python: 슬라이스 전 rows 로 판정
  return rows.map((r) => `${r.distinct}/${r.total}\t${r.slug}\t${r.type}\n`).join("");
}

/** scope-expand.py do_expand (rerank 없음): `tier\trefs\tslug\ttype`. */
export function renderExpand(G: Graph, rows: ExpandRow[]): string {
  return rows.map((r) => `${TIER_NAME[r.tier]}\t${r.refs}\t${r.slug}\t${G.nodes.get(r.slug)?.type ?? "?"}\n`).join("");
}

/** scope-expand.py do_expand (rerank): `tier\t{score:.1f}\tslug\ttype`. */
export function renderRerank(G: Graph, ranked: string[], scores: Map<string, number>, tierOf: Map<string, number>): string {
  return ranked
    .map((s) => `${TIER_NAME[tierOf.get(s) as number]}\t${fmt1(scores.get(s) as number)}\t${s}\t${G.nodes.get(s)?.type ?? "?"}\n`)
    .join("");
}

/** do_expand 에서 seed 가 없을 때 — **원본** terms(대소문자 유지, 필터 전). #17b */
export function renderNoSeed(rawTerms: string[]): string {
  return `no lexical seed for: ${rawTerms.join(" ")}\n`;
}

/** scope-expand.py do_pack. 없는 slug: `## slug\n(없음)\n` + print() 의 개행 → 빈 줄. */
export function renderPack(pages: PackPage[]): string {
  let out = "";
  for (const p of pages) {
    if (!p.found) {
      out += `## ${p.slug}\n(없음)\n\n`;
      continue;
    }
    out += `## ${p.slug}  [${p.type} · conf ${p.confidence} · ${p.status}]\n`;
    if (p.claims.length) for (const c of p.claims) out += `- ${c}\n`;
    else if (p.summary) out += `- (요약) ${p.summary}\n`;
    for (const r of p.relations) out += `- 관계) ${r}\n`;
    out += "\n";
  }
  return out;
}

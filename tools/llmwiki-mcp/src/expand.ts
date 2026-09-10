/**
 * expand.ts — Python `lex_score` · `lexical_seeds` · `expand` 포팅 (대응표 #12~#14).
 *
 * seed(tier0) ∪ 1홉 이웃(tier1, lexical 필터: distinct>0 또는 seed 2개+ 참조) ∪ MoC 멤버 소프트 Top-K(tier2, 필터 우회).
 * 최종 정렬 `(tier, -lex, -refs, slug)` → `[:max]`.
 */
import type { Graph, Node } from "./graph.js";
import { cmpCodePoint, countSub, pyLower } from "./vault.js";

export const MEMBER_K = 6; // Python MEMBER_K — MoC당 멤버 확장 상한

export interface ExpandRow {
  slug: string;
  tier: 0 | 1 | 2;
  refs: number;
}

export const TIER_NAME: Record<number, string> = { 0: "seed", 1: "1hop", 2: "moc" };

/** Python `lex_score(d, terms)` → (distinct, total). terms 는 소문자. */
export function lexScore(d: Node, terms: string[]): [number, number] {
  const hay = pyLower(d.text + "\n" + d.aliases);
  let distinct = 0;
  let total = 0;
  for (const t of terms) {
    const c = countSub(hay, t);
    if (c) distinct += 1;
    total += c; // Python: total = sum(hay.count(t) for t in terms)
  }
  return [distinct, total];
}

/** Python `lexical_seeds(G, terms, top)` — 정렬 `(-distinct, -total, slug)`. */
export function lexicalSeeds(G: Graph, terms: string[], top: number): string[] {
  const scored: { distinct: number; total: number; slug: string }[] = [];
  for (const [s, d] of G.nodes) {
    const [distinct, total] = lexScore(d, terms);
    if (distinct) scored.push({ distinct, total, slug: s });
  }
  scored.sort((a, b) => b.distinct - a.distinct || b.total - a.total || cmpCodePoint(a.slug, b.slug));
  return scored.slice(0, top).map((r) => r.slug);
}

/** Python `expand(G, terms, seeds, max_out)`. */
export function expand(G: Graph, terms: string[], seeds: string[], maxOut: number): ExpandRow[] {
  const lex = new Map<string, number>(); // distinct 캐시(멤버 랭킹용)
  for (const [s, d] of G.nodes) lex.set(s, lexScore(d, terms)[0]);
  const lexOf = (s: string): number => lex.get(s) ?? 0;

  const cand = new Map<string, [number, number]>(); // slug -> [tier, refs]
  const kept2 = new Set<string>();

  const bump = (n: string, tier: number): void => {
    let c = cand.get(n);
    if (!c) {
      c = [tier, 0];
      cand.set(n, c);
    }
    c[0] = Math.min(c[0], tier);
    c[1] += 1;
  };

  for (const s of seeds) cand.set(s, [0, 99]); // tier0 = seed

  const mocSeen = new Set<string>();
  for (const s of seeds) {
    const d = G.nodes.get(s);
    const neighbors = new Set<string>([...(d?.out ?? []), ...(d?.in ?? [])]);
    for (const n of neighbors) bump(n, 1);
    const mocNodes: string[] = d?.type === "moc" ? [s] : [];
    for (const n of neighbors) if (G.nodes.get(n)?.type === "moc") mocNodes.push(n);
    for (const mnode of mocNodes) {
      if (mocSeen.has(mnode)) continue;
      mocSeen.add(mnode);
      const members = [...(G.nodes.get(mnode)?.out ?? [])];
      members.sort((a, b) => lexOf(b) - lexOf(a) || cmpCodePoint(a, b)); // (-lex, m)
      for (const m of members.slice(0, MEMBER_K)) {
        bump(m, 2);
        kept2.add(m);
      }
    }
  }

  const rows: { tier: number; negLex: number; refs: number; slug: string }[] = [];
  for (const [slug, [tier, refs]] of cand) {
    if (tier === 0 || kept2.has(slug)) {
      rows.push({ tier, negLex: -lexOf(slug), refs, slug });
      continue;
    }
    // tier1 순수 1홉 이웃만 lexical 필터
    if (lexOf(slug) > 0 || refs >= 2) rows.push({ tier, negLex: -lexOf(slug), refs, slug });
  }
  rows.sort((a, b) => a.tier - b.tier || a.negLex - b.negLex || b.refs - a.refs || cmpCodePoint(a.slug, b.slug));
  return rows.slice(0, maxOut).map((r) => ({ slug: r.slug, tier: r.tier as 0 | 1 | 2, refs: r.refs }));
}

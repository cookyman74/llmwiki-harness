/**
 * once.ts — 4모드를 한 곳에서 실행해 텍스트를 돌려준다. `--once` CLI 와 P2 MCP 도구가 **같은 코드 경로**를 쓴다(P2-33).
 * 인자 파싱은 Python `main()` 과 동일: 알려진 옵션은 값 하나를 소비, 나머지는 위치 인자(terms/slugs).
 */
import path from "node:path";
import { bm25Rank } from "./bm25.js";
import { TIER_NAME, expand, lexIndex, lexicalSeeds } from "./expand.js";
import { renderExpand, renderNoSeed, renderPack, renderRerank, renderSearch } from "./format.js";
import { buildGraph } from "./graph.js";
import { pack, type PackPage } from "./pack.js";
import { filesMode, normalizeTerms, type SearchRow } from "./search.js";

export interface ExpandOptions {
  root: string;
  topSeed: number;
  max: number;
  rerank: number;
}

/** Python `main()` 의 옵션 파싱과 같은 엄격성: 값 없는 옵션은 오류(IndexError→exit 1), 정수 옵션은 `int()` 실패 시 오류
 *  (ValueError→exit 1; `--top 1.5` 를 1 로 받지 않는다 — 코덱스 P1 리뷰 #6). */
export class ArgError extends Error {
  readonly exitCode = 1;
}

export function parseArgs(rest: string[], known: Record<string, string>): { opts: Record<string, string>; positional: string[] } {
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a in known) {
      if (i + 1 >= rest.length) throw new ArgError(`option ${a} requires a value`);
      opts[known[a]] = rest[i + 1];
      i++;
    } else if (a === "--files") {
      // search.py 의 모드 플래그 — --once search 에서는 무시(호환)
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

/** Python `int(s)`: 양끝 공백 허용, 부호, 십진 숫자(밑줄 구분 허용)만. 그 외는 ValueError. */
export function pyInt(s: string, name: string): number {
  const t = s.trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) throw new ArgError(`invalid int for ${name}: ${JSON.stringify(s)}`);
  return parseInt(t.replace(/_/g, ""), 10);
}

function intOpt(opts: Record<string, string>, key: string, dflt: number): number {
  return opts[key] !== undefined ? pyInt(opts[key], key) : dflt;
}

/** Python search.py `files_mode`: 정규화 후 term 이 하나도 없으면 usage 를 stderr 에 내고 exit 2 (stdout 비움). */
export class UsageError extends Error {
  readonly exitCode = 2;
}

export interface SearchData {
  text: string;
  rows: SearchRow[];
  matched: number;
}
export interface ExpandDataRow {
  tier: "seed" | "1hop" | "moc";
  refs?: number;
  score?: number;
  slug: string;
  type: string;
}
export interface ExpandData {
  text: string;
  rows: ExpandDataRow[];
}
export interface PackData {
  text: string;
  pages: PackPage[];
}

/** search 데이터 + Python 동일 텍스트. MCP 도구(P2)와 --once 가 공유한다. */
export async function searchData(rawTerms: string[], root: string, top: number): Promise<SearchData> {
  if (normalizeTerms(rawTerms).length === 0) {
    throw new UsageError("usage: search.py --files <term> [term ...] [--root .] [--top N]");
  }
  const { terms, rows, matched } = await filesMode(rawTerms, root, top);
  return { text: renderSearch(terms, rows, matched), rows, matched };
}

export async function expandData(rawTerms: string[], o: ExpandOptions): Promise<ExpandData> {
  const G = await buildGraph(path.join(o.root, "wiki"));
  const tl = normalizeTerms(rawTerms); // Python: tl = [t.lower() for t in terms if t.strip()]
  const idx = lexIndex(G, tl); // 전 노드 lex_score 1회 — seeds·expand 가 공유(P4-12+)
  const seeds = lexicalSeeds(G, tl, o.topSeed, idx);
  if (seeds.length === 0) return { text: renderNoSeed(rawTerms), rows: [] };
  const rows = expand(G, tl, seeds, o.max, idx);
  const typeOf = (s: string): string => G.nodes.get(s)?.type ?? "?";
  if (o.rerank) {
    const pool = rows.map((r) => r.slug);
    const { ranked, scores } = bm25Rank(G, tl, pool);
    const tierOf = new Map(rows.map((r) => [r.slug, r.tier] as [string, number]));
    const top = ranked.slice(0, o.rerank);
    return {
      text: renderRerank(G, top, scores, tierOf),
      rows: top.map((s) => ({ tier: TIER_NAME[tierOf.get(s) as number] as ExpandDataRow["tier"], score: scores.get(s) as number, slug: s, type: typeOf(s) })),
    };
  }
  return {
    text: renderExpand(G, rows),
    rows: rows.map((r) => ({ tier: TIER_NAME[r.tier] as ExpandDataRow["tier"], refs: r.refs, slug: r.slug, type: typeOf(r.slug) })),
  };
}

export async function packData(slugs: string[], root: string): Promise<PackData> {
  const pages = await pack(slugs, root);
  return { text: renderPack(pages), pages };
}

export async function runSearch(rawTerms: string[], root: string, top: number): Promise<string> {
  return (await searchData(rawTerms, root, top)).text;
}

export async function runExpand(rawTerms: string[], o: ExpandOptions): Promise<string> {
  return (await expandData(rawTerms, o)).text;
}

export async function runPack(slugs: string[], root: string): Promise<string> {
  return (await packData(slugs, root)).text;
}

export async function runOnce(mode: "search" | "expand" | "pack", rest: string[]): Promise<string> {
  if (mode === "search") {
    const { opts, positional } = parseArgs(rest, { "--root": "root", "--top": "top" });
    return runSearch(positional, opts.root ?? ".", intOpt(opts, "top", 8));
  }
  if (mode === "expand") {
    const { opts, positional } = parseArgs(rest, { "--root": "root", "--top-seed": "topSeed", "--max": "max", "--rerank": "rerank" });
    return runExpand(positional, {
      root: opts.root ?? ".",
      topSeed: intOpt(opts, "topSeed", 6), // Python 기본값 6 / 15 / 0 (#21)
      max: intOpt(opts, "max", 15),
      rerank: intOpt(opts, "rerank", 0),
    });
  }
  const { opts, positional } = parseArgs(rest, { "--root": "root" });
  return runPack(positional, opts.root ?? ".");
}

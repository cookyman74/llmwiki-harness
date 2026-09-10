/**
 * once.ts — 4모드를 한 곳에서 실행해 텍스트를 돌려준다. `--once` CLI 와 P2 MCP 도구가 **같은 코드 경로**를 쓴다(P2-33).
 * 인자 파싱은 Python `main()` 과 동일: 알려진 옵션은 값 하나를 소비, 나머지는 위치 인자(terms/slugs).
 */
import path from "node:path";
import { bm25Rank } from "./bm25.js";
import { expand, lexicalSeeds } from "./expand.js";
import { renderExpand, renderNoSeed, renderPack, renderRerank, renderSearch } from "./format.js";
import { buildGraph } from "./graph.js";
import { pack } from "./pack.js";
import { filesMode, normalizeTerms } from "./search.js";

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

export async function runSearch(rawTerms: string[], root: string, top: number): Promise<string> {
  if (normalizeTerms(rawTerms).length === 0) {
    throw new UsageError("usage: search.py --files <term> [term ...] [--root .] [--top N]");
  }
  const { terms, rows, matched } = await filesMode(rawTerms, root, top);
  return renderSearch(terms, rows, matched);
}

export async function runExpand(rawTerms: string[], o: ExpandOptions): Promise<string> {
  const G = await buildGraph(path.join(o.root, "wiki"));
  const tl = normalizeTerms(rawTerms); // Python: tl = [t.lower() for t in terms if t.strip()]
  const seeds = lexicalSeeds(G, tl, o.topSeed);
  if (seeds.length === 0) return renderNoSeed(rawTerms);
  const rows = expand(G, tl, seeds, o.max);
  if (o.rerank) {
    const pool = rows.map((r) => r.slug);
    const { ranked, scores } = bm25Rank(G, tl, pool);
    const tierOf = new Map(rows.map((r) => [r.slug, r.tier] as [string, number]));
    return renderRerank(G, ranked.slice(0, o.rerank), scores, tierOf);
  }
  return renderExpand(G, rows);
}

export async function runPack(slugs: string[], root: string): Promise<string> {
  return renderPack(await pack(slugs, root));
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

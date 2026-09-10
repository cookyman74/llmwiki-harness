/**
 * P4-12+ (P1 코덱스 리뷰 #5 이월) — `lexIndex` 공유가 **출력을 바꾸지 않는다**는 회귀 고정.
 *
 * 최적화 내용: Python 정본은 `lexical_seeds` 와 `expand` 가 각각 전 노드에 `lex_score` 를 돌린다.
 * TS 는 호출당 1회만 계산해 두 함수가 공유한다. 구조가 정본과 달라지므로, 같은 입력에서
 * **인덱스 경로와 재계산 경로가 같은 값을 낸다**는 것을 여기서 직접 대조한다
 * (골든·패리티는 실행 경로 하나만 보므로 이 대조를 대신하지 못한다).
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expand, lexIndex, lexScore, lexicalSeeds, type LexIndex } from "../../src/expand.js";
import { renderExpand } from "../../src/format.js";
import { buildGraph, type Graph } from "../../src/graph.js";
import { normalizeTerms } from "../../src/search.js";

let root = "";
let G: Graph;

async function w(rel: string, text: string): Promise<void> {
  const p = path.join(root, "wiki", rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text, "utf8");
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p4-lex-"));
  // seed·1홉·MoC 멤버 세 갈래가 모두 생기는 미니 볼트(alias·비ASCII·중복어 포함).
  await w("L3/a-seed.md", "---\ntype: concept\naliases: [Alpha 별칭]\n---\n# A\nalpha alpha 청킹. [[b-page]] [[big-moc]]\n");
  await w("L3/b-page.md", "---\ntype: concept\n---\n# B\nlexical 매치 없음. [[a-seed]]\n");
  await w("L3/c-neighbor.md", "---\ntype: fact\n---\n# C\nalpha 를 가진 1홉 이웃. [[a-seed]] [[d-double]]\n");
  await w("L3/d-double.md", "---\ntype: entity\n---\n# D\n매치 없음, 참조 2. [[a-seed]]\n");
  await w("L3/e-seed2.md", "---\ntype: fact\n---\n# E\nalpha alpha alpha 청킹 임베딩. [[c-neighbor]]\n");
  await w("moc/big-moc.md", `---\ntype: moc\n---\n# MoC\n${[...Array(8)].map((_, i) => `[[m${i + 1}-member]]`).join(" ")} [[a-seed]]\n`);
  for (let i = 1; i <= 8; i++) {
    await w(`L3/m${i}-member.md`, `---\ntype: concept\n---\n# M${i}\n${i % 3 === 0 ? "alpha 포함" : "멤버 본문"} ${i}\n`);
  }
  G = await buildGraph(path.join(root, "wiki"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

// 매치 다수 · 부분 매치 · 무매치 · 빈 목록 · 비ASCII · 중복 term 을 모두 통과시킨다.
const TERM_SETS: string[][] = [
  ["alpha"],
  ["청킹"],
  ["alpha", "청킹", "임베딩"],
  ["없는단어"],
  [],
  ["alpha", "alpha"],
  ["Alpha", "별칭"],
  ["m", "a"],
];

describe("P4-12+ lexIndex — 공유 인덱스와 재계산이 동일", () => {
  it("lexIndex 값은 노드별 lexScore 와 정확히 같다", () => {
    for (const raw of TERM_SETS) {
      const tl = normalizeTerms(raw);
      const idx = lexIndex(G, tl);
      expect(idx.size).toBe(G.nodes.size);
      for (const [s, d] of G.nodes) expect(idx.get(s)).toEqual(lexScore(d, tl));
    }
  });

  it("lexicalSeeds: idx 유무가 seed 목록·순서를 바꾸지 않는다", () => {
    for (const raw of TERM_SETS) {
      const tl = normalizeTerms(raw);
      const idx = lexIndex(G, tl);
      for (const top of [1, 3, 6, 100]) {
        expect(lexicalSeeds(G, tl, top, idx)).toEqual(lexicalSeeds(G, tl, top));
      }
    }
  });

  it("expand: idx 유무가 행·tier·refs·정렬을 바꾸지 않는다", () => {
    for (const raw of TERM_SETS) {
      const tl = normalizeTerms(raw);
      const idx = lexIndex(G, tl);
      const seeds = lexicalSeeds(G, tl, 6, idx);
      for (const max of [1, 5, 15, 50]) {
        expect(expand(G, tl, seeds, max, idx)).toEqual(expand(G, tl, seeds, max));
      }
    }
  });

  it("expandData 와 같은 순서(인덱스 1회 → seeds → expand)로 만든 텍스트가 재계산 경로와 바이트 동일", () => {
    for (const raw of TERM_SETS) {
      const tl = normalizeTerms(raw);
      const idx = lexIndex(G, tl);
      const shared = renderExpand(G, expand(G, tl, lexicalSeeds(G, tl, 6, idx), 15, idx));
      const recomputed = renderExpand(G, expand(G, tl, lexicalSeeds(G, tl, 6), 15));
      expect(shared).toBe(recomputed);
    }
  });

  it("부분 인덱스(일부 노드 누락)여도 누락 노드를 그 자리에서 계산해 결과가 같다", () => {
    const tl = normalizeTerms(["alpha", "청킹"]);
    const full = lexIndex(G, tl);
    const partial: LexIndex = new Map();
    let i = 0;
    for (const [s, v] of full) {
      if (i++ % 2 === 0) partial.set(s, v); // 절반만 담긴 인덱스
    }
    const seeds = lexicalSeeds(G, tl, 6, partial);
    expect(seeds).toEqual(lexicalSeeds(G, tl, 6));
    expect(expand(G, tl, seeds, 15, partial)).toEqual(expand(G, tl, seeds, 15));
  });

  it("빈 인덱스는 전면 재계산과 같다(경계)", () => {
    const tl = normalizeTerms(["alpha"]);
    const empty: LexIndex = new Map();
    expect(lexicalSeeds(G, tl, 6, empty)).toEqual(lexicalSeeds(G, tl, 6));
    const seeds = lexicalSeeds(G, tl, 6);
    expect(expand(G, tl, seeds, 15, empty)).toEqual(expand(G, tl, seeds, 15));
  });
});

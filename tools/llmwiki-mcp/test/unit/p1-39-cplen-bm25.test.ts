// P1-39 — 대응표 #16: Python `len(str)` 은 코드포인트 수; BM25 dl·avgdl 은 코드포인트 기준.
// python3 확인 (2026-09-09):
//   len("🦀🚀")   -> 2      (JS "🦀🚀".length == 4)
//   len("한글🦀a") -> 4
//   bm25 (scope-expand.bm25_rank 를 직접 import 해 실행):
//     Gh = {"a": {"text": "🦀🦀🦀🦀 rerank", "aliases": ""}, "b": {"text": "rerank rerank foo", "aliases": ""}}
//     bm25_rank(Gh, ["rerank"], ["a", "b"])
//     -> (['b', 'a'], {'a': 0.20035335911423582, 'b': 0.24472692187108})
//   derivation: texts = lower(text+"\n"+aliases) → dl(a)=12 codepoints, dl(b)=18, N=2, avgdl=15
//     idf = log((2-2+0.5)/(2+0.5)+1) = log(1.2)
//     a: tf=1 → idf*2.5/(1+1.5*(0.25+0.75*12/15))
//     b: tf=2 → idf*5.0/(2+1.5*(0.25+0.75*18/15))
//   if dl(a) were UTF-16 length 16 (avgdl 17): a → 0.1872789405134277  (the trap value)
import { describe, expect, it } from "vitest";
import { bm25Rank, scoreText } from "../../src/bm25.js";
import type { Graph, Node } from "../../src/graph.js";
import { cpLen } from "../../src/vault.js";

function node(text: string, aliases = ""): Node {
  return { type: "x", aliases, out: new Set(), in: new Set(), text };
}

describe("P1-39 #16 cpLen / bm25 dl", () => {
  it("P1-39 #16 cpLen: '🦀🚀'.length === 4 but cpLen === 2", () => {
    expect("🦀🚀".length).toBe(4);
    expect(cpLen("🦀🚀")).toBe(2);
  });

  it("P1-39 #16 cpLen: mixed Korean + emoji + ascii '한글🦀a' → 4; ascii/Korean-only equal .length", () => {
    expect(cpLen("한글🦀a")).toBe(4);
    expect(cpLen("한글")).toBe(2);
    expect(cpLen("abc")).toBe(3);
    expect(cpLen("")).toBe(0);
    // lone surrogate counts as 1 code point (python len of a lone surrogate str is 1)
    expect(cpLen("\ud83e")).toBe(1);
  });

  it("P1-39 #16 scoreText: dl of '🦀🦀🦀🦀 rerank' + '\\n' is 12 code points (UTF-16 would be 16)", () => {
    const tx = scoreText(node("🦀🦀🦀🦀 rerank"));
    expect(cpLen(tx)).toBe(12);
    expect(tx.length).toBe(16);
  });

  it("P1-39 #16 bm25Rank: hand-built 2-node graph scores equal python bm25_rank (code-point dl)", () => {
    const G: Graph = {
      nodes: new Map([
        ["a", node("🦀🦀🦀🦀 rerank")],
        ["b", node("rerank rerank foo")],
      ]),
      alias2slug: new Map(),
    };
    const { ranked, scores } = bm25Rank(G, ["rerank"], ["a", "b"]);
    expect(ranked).toEqual(["b", "a"]);
    expect(scores.get("a") as number).toBeCloseTo(0.20035335911423582, 9);
    expect(scores.get("b") as number).toBeCloseTo(0.24472692187108, 9);
    // the UTF-16-length trap value must NOT be produced
    expect(Math.abs((scores.get("a") as number) - 0.1872789405134277)).toBeGreaterThan(1e-6);
  });

  it("P1-39 #16 bm25Rank: terms are de-duplicated and 1-code-point terms dropped (python len(t) >= 2)", () => {
    const G: Graph = {
      nodes: new Map([
        ["a", node("x 🦀 rerank")],
        ["b", node("rerank")],
      ]),
      alias2slug: new Map(),
    };
    // '🦀' has .length 2 but is 1 code point → dropped like python; 'x' dropped; 'rerank' duplicated → once
    const once = bm25Rank(G, ["rerank"], ["a", "b"]);
    const noisy = bm25Rank(G, ["rerank", "🦀", "x", "rerank"], ["a", "b"]);
    expect(noisy.scores.get("a")).toBe(once.scores.get("a"));
    expect(noisy.scores.get("b")).toBe(once.scores.get("b"));
  });
});

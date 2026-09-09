// Fixture-golden smoke (P1 section H): test/fixtures/queries.json × 4 modes, run in-process through runOnce() with the
// same argv shape as gen-expected.py's commands(), compared to expected/<id>-<mode>.txt.
//   search / expand / pack : exact string equality (bytes as UTF-8 text)
//   rerank                 : same row count, same tier/slug/type per row in order, |Δscore| ≤ 0.05 (DESIGN §7 tolerance)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOnce } from "../../src/once.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "..", "fixtures");
const VAULT = path.join(FIX, "vault");
const EXPECTED = path.join(FIX, "expected");

interface Query {
  id: string;
  terms: string[];
  case: string;
  pack_slugs: string[];
}
interface Spec {
  defaults: { search_top: number; expand_max: number; expand_top_seed: number; rerank_max: number; rerank_n: number };
  queries: Query[];
}

const spec = JSON.parse(readFileSync(path.join(FIX, "queries.json"), "utf8")) as Spec;
const d = spec.defaults;

/** Mirrors gen-expected.py commands(q, d) minus the interpreter/script prefix. */
function commands(q: Query): Record<"search" | "expand" | "rerank" | "pack", { mode: "search" | "expand" | "pack"; rest: string[] }> {
  const t = q.terms;
  return {
    search: { mode: "search", rest: ["--files", ...t, "--root", VAULT, "--top", String(d.search_top)] },
    expand: { mode: "expand", rest: [...t, "--root", VAULT, "--top-seed", String(d.expand_top_seed), "--max", String(d.expand_max)] },
    rerank: {
      mode: "expand",
      rest: [...t, "--root", VAULT, "--top-seed", String(d.expand_top_seed), "--max", String(d.rerank_max), "--rerank", String(d.rerank_n)],
    },
    pack: { mode: "pack", rest: [...q.pack_slugs, "--root", VAULT] },
  };
}

function expected(id: string, mode: string): string {
  return readFileSync(path.join(EXPECTED, `${id}-${mode}.txt`), "utf8");
}

interface RerankRow {
  tier: string;
  score: number;
  slug: string;
  type: string;
}

function parseRerank(text: string): RerankRow[] {
  const lines = text.split("\n");
  expect(lines[lines.length - 1]).toBe(""); // trailing newline
  return lines.slice(0, -1).map((ln) => {
    const cols = ln.split("\t");
    expect(cols).toHaveLength(4);
    // 점수 열은 Python `.1f` 형식이고 유한값 — `Number("NaN")` 이 |Δ| 비교를 통과하는 허점 차단(코덱스 P1 리뷰 #3)
    expect(cols[1]).toMatch(/^-?\d+\.\d$/);
    const score = Number(cols[1]);
    expect(Number.isFinite(score)).toBe(true);
    return { tier: cols[0], score, slug: cols[2], type: cols[3] };
  });
}

describe("golden: queries.json × modes vs expected/ (in-process runOnce)", () => {
  expect(spec.queries.length).toBeGreaterThan(0);
  for (const q of spec.queries) {
    const cmds = commands(q);
    for (const mode of ["search", "expand", "pack"] as const) {
      it(`golden ${q.id}-${mode} exact — ${q.case}`, async () => {
        const got = await runOnce(cmds[mode].mode, cmds[mode].rest);
        expect(got).toBe(expected(q.id, mode));
      });
    }
    it(`golden ${q.id}-rerank tolerant (tier/slug/type/order exact, |Δscore| ≤ 0.05) — ${q.case}`, async () => {
      const got = await runOnce(cmds.rerank.mode, cmds.rerank.rest);
      const want = expected(q.id, "rerank");
      if (!want.includes("\t")) {
        // "no lexical seed for: …" path — no rows, must be byte-identical
        expect(got).toBe(want);
        return;
      }
      const g = parseRerank(got);
      const w = parseRerank(want);
      expect(g.length).toBe(w.length);
      for (let i = 0; i < w.length; i++) {
        expect({ tier: g[i].tier, slug: g[i].slug, type: g[i].type }).toEqual({ tier: w[i].tier, slug: w[i].slug, type: w[i].type });
        expect(Math.abs(g[i].score - w[i].score)).toBeLessThanOrEqual(0.05);
      }
    });
  }
});

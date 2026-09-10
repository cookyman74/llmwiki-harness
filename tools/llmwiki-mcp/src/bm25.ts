/**
 * bm25.ts — Python `_score_text` · `bm25_rank` 포팅 (대응표 #15~#17).
 *
 * IDF 는 전체 코퍼스, tf·dl 은 후보 본문+aliases. dl·avgdl 은 **코드포인트 수**(Python len). k1=1.5, b=0.75.
 * 부동소수점 연산 순서를 Python 식과 동일하게 유지한다(`idf*(tf*(k1+1)) / (tf + k1*(1-b + b*dl/avgdl))`).
 * `Math.log` 와 libm `log` 는 1 ULP 차이가 날 수 있어 점수 열은 패리티에서 허용오차 대상(DESIGN §7).
 */
import type { Graph, Node } from "./graph.js";
import { PY_WS_CLASS, cmpCodePoint, countSub, cpLen, pyLower } from "./vault.js";

const MD_LINK_RE = /\]\([^)]*\)/g; // `[텍스트](url)` → `텍스트]`
const URL_RE = new RegExp(`https?://[^${PY_WS_CLASS}]+`, "g"); // Python `\S+` = not isspace

/** Python `_score_text(d)` — 링크 타겟·URL 제거 후 소문자. #15 */
export function scoreText(d: Node): string {
  let t = d.text + "\n" + d.aliases;
  t = t.replace(MD_LINK_RE, "]");
  t = t.replace(URL_RE, "");
  return pyLower(t);
}

/** Python `bm25_rank(G, terms, cand_slugs, k1=1.5, b=0.75)` → (정렬된 slug, scores). #16 #17
 *  terms: 중복 제거(순서 유지) + 길이(코드포인트)<2 제외. 정렬 `(-score, slug)`. */
export function bm25Rank(
  G: Graph,
  rawTerms: string[],
  cand: string[],
  k1 = 1.5,
  b = 0.75,
): { ranked: string[]; scores: Map<string, number> } {
  const terms = [...new Set(rawTerms.filter((t) => cpLen(t) >= 2))];
  const N = G.nodes.size;
  const texts = new Map<string, string>();
  const dlOf = new Map<string, number>(); // 코드포인트 길이 1회 계산(agy 2차 리뷰 #4) — 결과 무변경
  let sumdl = 0;
  for (const [s, d] of G.nodes) {
    const tx = scoreText(d);
    const dl = cpLen(tx);
    texts.set(s, tx);
    dlOf.set(s, dl);
    sumdl += dl;
  }
  const avgdl = sumdl / Math.max(N, 1);
  const idf = new Map<string, number>();
  for (const t of terms) {
    let df = 0;
    for (const tx of texts.values()) if (tx.includes(t)) df += 1;
    idf.set(t, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  const scores = new Map<string, number>();
  for (const s of cand) {
    const tx = texts.get(s) ?? "";
    const dl = (dlOf.get(s) ?? cpLen(tx)) || 1; // Python: dl = len(tx) or 1
    let sc = 0.0;
    for (const t of terms) {
      const tf = countSub(tx, t);
      if (tf) {
        // Python: sc += idf[t] * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))
        sc += ((idf.get(t) as number) * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * dl) / avgdl));
      }
    }
    scores.set(s, sc);
  }
  const ranked = [...cand].sort((x, y) => (scores.get(y) as number) - (scores.get(x) as number) || cmpCodePoint(x, y));
  return { ranked, scores };
}

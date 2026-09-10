/**
 * search.ts — Python `search.py --files` (`files_mode`) 포팅.
 *
 * 그래프가 아니라 **파일 단위**로 순회한다 — 중복 slug 파일은 각각 한 행이 된다(그래프의 마지막 승과 다름).
 * 정렬 `(-distinct, -total, slug)` (slug 는 코드포인트 순). `top` 은 상한(fill 아님).
 */
import path from "node:path";
import { cacheEnabled, readTexts, snapshot } from "./cache.js";
import { cmpCodePoint, countSub, field, frontmatter, pyLower, pyStrip, readAll, walkMd } from "./vault.js";

export interface SearchRow {
  distinct: number;
  total: number;
  slug: string;
  type: string;
}

/** Python: `terms = [t.lower() for t in terms if t.strip()]` */
export function normalizeTerms(terms: string[]): string[] {
  return terms.filter((t) => pyStrip(t) !== "").map(pyLower);
}

export async function filesMode(
  rawTerms: string[],
  root: string,
  top: number,
): Promise<{ terms: string[]; rows: SearchRow[]; matched: number }> {
  const terms = normalizeTerms(rawTerms);
  const base = path.join(root, "wiki");
  const files = await walkMd(base);
  // 그래프 경로와 같은 텍스트 캐시를 쓴다(P4-06) — 순회·경계 검사는 호출마다 그대로 수행한 뒤에 붙는다.
  const texts = cacheEnabled() ? await readTexts(base, files, await snapshot(base, files)) : await readAll(files);
  const rows: SearchRow[] = [];
  files.forEach((f, i) => {
    const text = texts[i];
    const fm = frontmatter(text);
    const hay = pyLower(text + "\n" + field(fm, "aliases"));
    let distinct = 0;
    let total = 0;
    for (const t of terms) {
      const c = countSub(hay, t);
      if (c) {
        distinct += 1;
        total += c;
      }
    }
    if (distinct === 0) return;
    rows.push({ distinct, total, slug: f.slug, type: field(fm, "type") || path.basename(path.dirname(f.path)) });
  });
  rows.sort((a, b) => b.distinct - a.distinct || b.total - a.total || cmpCodePoint(a.slug, b.slug));
  // Python: `if not rows: print("no matches…")` 는 슬라이스 **전** 판정 → top=0 이면 빈 출력(미매치 메시지 아님).
  return { terms, rows: rows.slice(0, top), matched: rows.length };
}

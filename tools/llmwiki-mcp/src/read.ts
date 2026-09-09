/**
 * read.ts — `wiki_read_page`: 절차 질의용 전문 read (DESIGN §3.4, §5; P2-08, P2-18).
 *
 * - slug 는 tools.ts normalizeSlug 로 정규화·검증된 상태로 들어온다(경로 문자 금지).
 * - `wiki/**` 아래에서 slug 일치 파일을 찾는다(walk 순서·마지막 승 — pack 과 동일).
 * - 없으면 그래프 alias2slug(소문자 키)로 1회 리다이렉트(Python pack 에는 없는 read_page 고유 동작).
 * - 대상 파일 realpath 가 `<root>/wiki` 하위인지 `path.relative` 로 판정(문자열 startsWith 금지 — `wiki2/` 우회·Windows 구분자).
 * - 200 KB 절단 + truncated.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildGraph } from "./graph.js";
import { FIELD_LIMIT, capText } from "./tools.js";
import { field, frontmatter, pyLower, read, stripChars, walkMd } from "./vault.js";

export interface ReadPageResult {
  slug: string;
  resolved_from_alias: boolean;
  path: string;
  frontmatter: { type: string; confidence: string; status: string; superseded_by?: string; last_confirmed?: string };
  text: string;
  truncated: boolean;
}

export class PageNotFound extends Error {}

/** frontmatter 스칼라 상한(FIELD_LIMIT 바이트). 실제 위키 값은 수십 바이트라 절단은 병리적 입력에서만 일어난다. */
function capField(v: string): string {
  return capText(v, FIELD_LIMIT).text;
}

/** `target` 의 실경로가 `baseReal` 디렉터리 안에 있는가. */
export async function isInside(baseReal: string, target: string): Promise<boolean> {
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    return false;
  }
  const rel = path.relative(baseReal, real);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function readPage(root: string, slug: string): Promise<ReadPageResult> {
  const wiki = path.join(root, "wiki");
  const wikiReal = await fs.realpath(wiki);
  const files = await walkMd(wiki);
  const idx = new Map<string, string>();
  for (const f of files) idx.set(f.slug, f.path); // 마지막 승
  let resolved = slug;
  let resolvedFromAlias = false;
  if (!idx.has(resolved)) {
    const G = await buildGraph(wiki, files); // 순회 목록 재사용(이중 walk 방지)
    const viaAlias = G.alias2slug.get(pyLower(slug));
    if (viaAlias && idx.has(viaAlias)) {
      resolved = viaAlias;
      resolvedFromAlias = true;
    } else {
      throw new PageNotFound(`page not found: ${slug}`);
    }
  }
  const p = idx.get(resolved) as string;
  if (!(await isInside(wikiReal, p))) throw new PageNotFound(`page not found: ${slug}`); // 경계 밖(심볼릭 링크 등)은 없는 것으로 취급
  const raw = await read(p);
  const fm = frontmatter(raw);
  const { text, truncated } = capText(raw);
  const out: ReadPageResult = {
    slug: resolved,
    resolved_from_alias: resolvedFromAlias,
    path: path.relative(root, p).split(path.sep).join("/"),
    // frontmatter 값도 상한을 둔다 — 페이지가 정한 문자열이라 무제한이면 응답 envelope 예산을 넘길 수 있다(P2 3차 테스트 검토)
    frontmatter: {
      type: capField(field(fm, "type") || path.basename(path.dirname(p))),
      confidence: capField(field(fm, "confidence") || "-"),
      status: capField(field(fm, "status") || "active"),
    },
    text,
    truncated,
  };
  // frontmatter 값의 겉 따옴표만 제거(`"[[x]]"` → `[[x]]`) — 클라이언트가 그대로 다음 slug 로 쓰기 쉽게
  const sb = capField(stripChars(field(fm, "superseded_by"), "'\""));
  if (sb) out.frontmatter.superseded_by = sb;
  const lc = capField(stripChars(field(fm, "last_confirmed"), "'\""));
  if (lc) out.frontmatter.last_confirmed = lc;
  return out;
}

/**
 * graph.ts — Python `build_graph(base)` 포팅 (대응표 #7, #8).
 *
 * slug → {type, aliases(원문 문자열), out, in, text} + alias2slug. 링크 타겟은 slug 존재 시 그대로,
 * 아니면 alias2slug[lower] 로 정규화. 자기 링크 제외. 중복 slug 는 walk 순서상 **마지막 승**(dict 대입).
 */
import path from "node:path";
import { field, frontmatter, parseAliases, pyLower, pyStrip, readAll, walkMd, type MdFile } from "./vault.js";

/** Python `LINK = re.compile(r"(?<!!)\[\[([^\]|#]+)")` — `![[…]]` 임베드 제외. #7 */
export const LINK_RE = /(?<!!)\[\[([^\]|#]+)/g;

export interface Node {
  type: string;
  aliases: string;
  out: Set<string>;
  in: Set<string>;
  text: string;
}

export interface Graph {
  nodes: Map<string, Node>;
  alias2slug: Map<string, string>;
}

/** `files` 를 주면 walkMd 를 생략한다(read_page 가 이미 순회한 목록 재사용 — 리뷰: 이중 순회). */
export async function buildGraph(base: string, files?: MdFile[]): Promise<Graph> {
  files ??= await walkMd(base);
  const texts = await readAll(files);
  const nodes = new Map<string, Node>();
  const alias2slug = new Map<string, string>();

  files.forEach((f, i) => {
    const text = texts[i];
    const fm = frontmatter(text);
    const typ = field(fm, "type") || path.basename(path.dirname(f.path)); // #5 (graph: dirname 기본값)
    const aliases = field(fm, "aliases");
    const out = new Set<string>();
    for (const m of text.matchAll(LINK_RE)) out.add(pyStrip(m[1])); // Python: set(m.strip() for m in LINK.findall(text))
    // Python: G[slug] = {...}  (마지막 승) / alias2slug[slug.lower()] = slug (대입 — 마지막 승)
    nodes.set(f.slug, { type: typ, aliases, out, in: new Set(), text });
    alias2slug.set(pyLower(f.slug), f.slug);
    // aliases 는 setdefault — 먼저 등록한 것이 이김. #8
    for (const a of parseAliases(aliases)) {
      const k = pyLower(a);
      if (!alias2slug.has(k)) alias2slug.set(k, f.slug);
    }
  });

  // 링크 정규화 + 인링크
  const inl = new Map<string, Set<string>>();
  for (const s of nodes.keys()) inl.set(s, new Set());
  for (const [s, d] of nodes) {
    const norm = new Set<string>();
    for (const t of d.out) {
      const tgt = nodes.has(t) ? t : alias2slug.get(pyLower(t));
      if (tgt && nodes.has(tgt) && tgt !== s) {
        norm.add(tgt);
        (inl.get(tgt) as Set<string>).add(s);
      }
    }
    d.out = norm;
  }
  for (const [s, d] of nodes) d.in = inl.get(s) as Set<string>;
  return { nodes, alias2slug };
}

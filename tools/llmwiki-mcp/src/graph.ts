/**
 * graph.ts — Python `build_graph(base)` 포팅 (대응표 #7, #8).
 *
 * slug → {type, aliases(원문 문자열), out, in, text} + alias2slug. 링크 타겟은 slug 존재 시 그대로,
 * 아니면 alias2slug[lower] 로 정규화. 자기 링크 제외. 중복 slug 는 walk 순서상 **마지막 승**(dict 대입).
 */
import path from "node:path";
import { cacheEnabled, getGraph, readTexts, setGraph, snapshot } from "./cache.js";
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

/** `files` 를 주면 walkMd 를 생략한다(read_page 가 이미 순회한 목록 재사용 — 리뷰: 이중 순회).
 *
 * 순회·경계 검사 뒤에 프로세스 내 mtime 캐시가 붙는다(P4-06). 스냅샷이 같으면 **같은 Graph 객체**를
 * 그대로 돌려주고(파생 메모까지 함께 재사용), 다르면 바뀐 파일만 다시 읽어 그래프를 통째로 다시 만든다.
 * `LLMWIKI_CACHE=0` 이면 stat 스캔도 하지 않고 예전 경로(readAll)로 간다. */
export async function buildGraph(base: string, files?: MdFile[]): Promise<Graph> {
  files ??= await walkMd(base);
  if (!cacheEnabled()) return assemble(files, await readAll(files));
  const snap = await snapshot(base, files);
  const hit = getGraph(base, snap);
  if (hit) return hit;
  const G = assemble(files, await readTexts(base, files, snap));
  setGraph(base, snap, G); // 저장 시 노드를 새 세대로 등록 — 파생 예산도 여기서 리셋된다
  return G;
}

/** 읽어 온 본문으로 그래프를 만든다 — 캐시 유무와 무관한 순수 조립부(정확성: 부분 갱신 없음, P4-03). */
function assemble(files: MdFile[], texts: string[]): Graph {
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

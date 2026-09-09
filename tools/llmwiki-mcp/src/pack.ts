/**
 * pack.ts — Python `do_pack(slugs, root)` 포팅 (대응표 #18~#20, #5 비대칭).
 *
 * - 헤더 type 기본값은 `?` (graph/search 의 dirname 기본값과 **비대칭** — Python 정본 `field(fm,"type") or "?"`, P0 리뷰).
 * - claims 는 **코드펜스 토글 없이** 문서 전체 스캔(#18). 관계 추출만 펜스 내부를 건너뜀(#20).
 * - claims 없으면 `split("---", 2)[-1]` 이후 첫 실문단 1개(#19).
 * - slug→path 는 walk 순서 마지막 승(#1).
 */
import path from "node:path";
import { PY_WS_CLASS, field, frontmatter, pyLower, pyStrip, read, splitN, walkMd } from "./vault.js";

export interface PackPage {
  slug: string;
  found: boolean;
  type: string;
  confidence: string;
  status: string;
  claims: string[];
  summary: string;
  relations: string[];
}

// Python: re.findall(r"^-?\s*claim::\s*(.+)$", text, re.MULTILINE)  — `.` 은 개행만 제외 → [^\n]
const CLAIM_RE = new RegExp(`^-?[${PY_WS_CLASS}]*claim::[${PY_WS_CLASS}]*([^\\n]+)$`, "gm");
// Python: re.compile(r"-\s*([\w-]+\s*::\s*\[\[[^\]]+\]\].*)$") 를 stripped line 에 `.match`(선두 앵커).
// Python `\w`(유니코드) → `[\p{L}\p{N}_]` (u 플래그). JS `\w` 는 ASCII 라 한국어 술어가 탈락한다(#20).
const REL_RE = new RegExp(`^-[${PY_WS_CLASS}]*([\\p{L}\\p{N}_-]+[${PY_WS_CLASS}]*::[${PY_WS_CLASS}]*\\[\\[[^\\]]+\\]\\][^\\n]*)$`, "u");

export function extractClaims(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CLAIM_RE)) out.push(pyStrip(m[1]));
  return out;
}

export function extractSummary(text: string): string {
  const parts = splitN(text, "---", 2);
  const body = parts[parts.length - 1];
  for (const ln of body.split("\n")) {
    const t = pyStrip(ln);
    if (t && !"#!>|-".includes(t[0]) && !t.startsWith("[")) return t;
  }
  return "";
}

export function extractRelations(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const ln of text.split("\n")) {
    const s = pyStrip(ln);
    if (s.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = REL_RE.exec(s);
    if (m && !pyLower(m[1]).startsWith("claim")) out.push(pyStrip(m[1]));
  }
  return out;
}

export async function pack(slugs: string[], root: string): Promise<PackPage[]> {
  const base = path.join(root, "wiki");
  const idx = new Map<string, string>();
  for (const f of await walkMd(base)) idx.set(f.slug, f.path); // 마지막 승
  const pages: PackPage[] = [];
  for (const slug of slugs) {
    const p = idx.get(slug);
    if (!p) {
      pages.push({ slug, found: false, type: "?", confidence: "-", status: "active", claims: [], summary: "", relations: [] });
      continue;
    }
    const text = await read(p);
    const fm = frontmatter(text);
    const claims = extractClaims(text);
    pages.push({
      slug,
      found: true,
      type: field(fm, "type") || "?",
      confidence: field(fm, "confidence") || "-",
      status: field(fm, "status") || "active",
      claims,
      summary: claims.length ? "" : extractSummary(text),
      relations: extractRelations(text),
    });
  }
  return pages;
}

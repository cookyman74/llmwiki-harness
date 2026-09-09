/**
 * tools.ts — MCP 도구 4개의 계약(이름·description·inputSchema·outputSchema)과 입력 정규화·검증 (DESIGN §3, P2-05~P2-14).
 *
 * 스키마는 **수기 JSON Schema 부분집합**이다(type object/array/string/integer/boolean · properties · required · items ·
 * enum · description · minimum/maximum · minItems/maxItems · minLength/maxLength). 이유(2026-09-09 실측, P2 결정):
 * `McpServer`+zod 경로는 tools/list 에 `$schema`·`additionalProperties:false`·`execution` 을 자동 삽입해 §3 호환 규칙을
 * 어긴다. 저수준 `Server` 에 JSON 을 직접 주면 쓴 그대로 나간다. 검증은 런타임(핸들러 첫 줄)에서 한다 — 스키마에
 * anyOf/preprocess 를 드러내지 않기 위해(P2-11).
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export const RESPONSE_LIMIT = 200 * 1024; // 응답 JSON envelope 전체 상한(codex 3차 #4)
export const FIELD_LIMIT = 4 * 1024; // frontmatter 스칼라 1개 상한(P2 3차: 무제한 값이 envelope 예산 우회)
export const TEXT_LIMIT = 200 * 1024; // 응답 텍스트 상한 — **UTF-8 바이트** 기준(P2-10; 리뷰: UTF-16 길이는 한글에서 3배 초과)
export const LIMITS = {
  termsMax: 10,
  termLen: 64,
  topMin: 1,
  topMax: 50,
  topDefault: 8,
  maxMin: 1,
  maxMax: 50,
  maxDefault: 15,
  topSeedMin: 1,
  topSeedMax: 20,
  topSeedDefault: 6,
  rerankMin: 0,
  rerankMax: 50,
  rerankDefault: 0,
  slugsMax: 30,
  slugLen: 120,
} as const;

const ROUTING_TABLE =
  "single lookup → wiki_expand(max≤6), answer from seeds · factual briefing/comparison → wiki_expand(rerank=11) then wiki_pack · procedure/how-to → wiki_expand(max=8) then wiki_read_page";
// 도구별 마지막 줄 = 그 도구의 실제 호출 위치(리뷰: 동일 문장 반복은 위치를 드러내지 못함). 표 전체는 진입점(wiki_expand)과 instructions 에.
// 각 description ≤500자 규칙(P2-14) 때문에 나머지 도구는 한 줄 위치만 적는다.
const ROUTING_LINE_SEARCH = "Routing: fallback only — after wiki_expand returned too few candidates.";
const ROUTING_LINE_EXPAND = `Routing: FIRST call for every wiki question, then follow suggested_next (${ROUTING_TABLE}).`;
const ROUTING_LINE_PACK = "Routing: after wiki_expand(rerank=11) for factual briefings/comparisons; usually the last call.";
const ROUTING_LINE_READ = "Routing: after wiki_expand(max=8) for procedures, or to verify one claim the pack could not settle.";

const int = (min: number, max: number, dflt: number, description: string): JsonSchema => ({
  type: "integer",
  minimum: min,
  maximum: max,
  description: `${description} (default ${dflt})`,
});

const termsSchema: JsonSchema = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: LIMITS.termLen },
  minItems: 1,
  maxItems: LIMITS.termsMax,
  description: "Keywords (2–4 recommended, add synonyms/variants; Korean and English both fine). Matched case-insensitively against page body and aliases.",
};

export const TOOLS: ToolDef[] = [
  {
    name: "wiki_expand",
    description:
      "Graph-expanded candidates (read-only): lexical seeds → 1-hop neighbors → MoC members, optional BM25 rerank. Returns slugs with tier and a suggested_next hint.\n" +
      "질의 시작점. 키워드→seed→관계 1홉→MoC 확장(옵션 rerank). suggested_next 를 따라 다음 도구를 고른다.\n" +
      ROUTING_LINE_EXPAND,
    inputSchema: {
      type: "object",
      properties: {
        terms: termsSchema,
        max: int(LIMITS.maxMin, LIMITS.maxMax, LIMITS.maxDefault, "Expansion pool cap"),
        top_seed: int(LIMITS.topSeedMin, LIMITS.topSeedMax, LIMITS.topSeedDefault, "Number of lexical seeds"),
        rerank: int(LIMITS.rerankMin, LIMITS.rerankMax, LIMITS.rerankDefault, "0 = no rerank; 11 recommended for factual briefings"),
      },
      required: ["terms"],
    },
    outputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tier: { type: "string", enum: ["seed", "1hop", "moc"] },
              refs: { type: "integer" },
              score: { type: "number" },
              slug: { type: "string" },
              type: { type: "string" },
            },
            required: ["tier", "slug", "type"],
          },
        },
        suggested_next: { type: "string", enum: ["wiki_pack", "wiki_read_page", "answer"] },
        truncated: { type: "boolean" },
      },
      required: ["text", "rows", "suggested_next", "truncated"],
    },
  },
  {
    name: "wiki_pack",
    description:
      "Context pack for candidate pages (read-only): type · confidence · status + claims + relations. Cite confidence; if stale, follow superseded_by. If claims suffice, do NOT read full pages.\n" +
      "후보 slug 의 claims·confidence·status·관계 팩. confidence 병기, stale 은 superseded_by 추적, 충분하면 full-read 금지.\n" +
      ROUTING_LINE_PACK,
    inputSchema: {
      type: "object",
      properties: {
        slugs: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: LIMITS.slugLen },
          minItems: 1,
          maxItems: LIMITS.slugsMax,
          description: "Page slugs from wiki_expand (file names without .md; [[…]] brackets are tolerated)",
        },
      },
      required: ["slugs"],
    },
    outputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        pages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              found: { type: "boolean" },
              type: { type: "string" },
              confidence: { type: "string" },
              status: { type: "string" },
              claims: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              relations: { type: "array", items: { type: "string" } },
            },
            required: ["slug", "found", "type", "confidence", "status", "claims", "summary", "relations"],
          },
        },
        truncated: { type: "boolean" },
      },
      required: ["text", "pages", "truncated"],
    },
  },
  {
    name: "wiki_read_page",
    description:
      "LAST RESORT — full text of ONE page (read-only, 200 KB cap). Only for procedure/how-to questions, or to settle one claim wiki_pack could not. At most 1–2 calls per question; never use it to browse or to answer a factual briefing.\n" +
      "**최후 수단** — 절차·how-to, 또는 팩이 못 정한 주장 1건 확인용. 질의당 1~2회. 브라우징·사실브리핑 금지.\n" +
      ROUTING_LINE_READ,
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", minLength: 1, maxLength: LIMITS.slugLen, description: "Page slug (file name without .md). Aliases are resolved once." },
      },
      required: ["slug"],
    },
    outputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        resolved_from_alias: { type: "boolean" },
        path: { type: "string", description: "Relative to the vault root" },
        frontmatter: {
          type: "object",
          properties: {
            type: { type: "string" },
            confidence: { type: "string" },
            status: { type: "string" },
            superseded_by: { type: "string" },
            last_confirmed: { type: "string" },
          },
          required: ["type", "confidence", "status"],
        },
        text: { type: "string" },
        truncated: { type: "boolean" },
      },
      required: ["slug", "resolved_from_alias", "path", "frontmatter", "text", "truncated"],
    },
  },
  {
    name: "wiki_search",
    description:
      "FALLBACK ONLY — call wiki_expand first; use this only when wiki_expand returned too few candidates. Lexical file ranking over the llmwiki vault (read-only), sorted by distinct-keyword count then total hits.\n" +
      "**fallback 전용** — 먼저 wiki_expand 를 부르고, 후보가 빈약할 때만 쓴다.\n" +
      ROUTING_LINE_SEARCH,
    inputSchema: {
      type: "object",
      properties: { terms: termsSchema, top: int(LIMITS.topMin, LIMITS.topMax, LIMITS.topDefault, "Max rows (cap, not fill)") },
      required: ["terms"],
    },
    outputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Same text as the Python search.py --files output" },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { distinct: { type: "integer" }, total: { type: "integer" }, slug: { type: "string" }, type: { type: "string" } },
            required: ["distinct", "total", "slug", "type"],
          },
        },
        matched: { type: "integer", description: "Rows before the top cap" },
        truncated: { type: "boolean" },
      },
      required: ["text", "rows", "matched", "truncated"],
    },
  },
];

export const SERVER_INSTRUCTIONS =
  "llmwiki: read-only retrieval over an Obsidian LLM-wiki vault. Never write; filing/ingest/lint happen inside the vault's own tooling.\n" +
  `Routing: ${ROUTING_TABLE}.` +
  "\n" +
  "Always cite confidence from the pack/frontmatter; if a page is status: stale, follow superseded_by and prefer the active page. Prefer wiki_pack claims over full page reads.";

// ---------------------------------------------------------------------------
// 입력 정규화·검증 (P2-11): LLM 클라이언트의 흔한 변형을 관대하게 받고, 상한·형식은 엄격하게.
// ---------------------------------------------------------------------------

export class ToolInputError extends Error {}

/** `terms` 가 문자열이면 공백 분할, 배열이면 각 항목 문자열 확인 → 빈 항목 제거. */
/** 원시 입력 크기 가드(codex 2차 #3): 분할·순회 **전에** 문자열 길이·배열 길이를 본다. */
export const RAW_INPUT_MAX_CHARS = 4096;
export const RAW_ARRAY_MAX_ITEMS = 256;
function guardRaw(v: unknown, name: string): void {
  if (typeof v === "string" && v.length > RAW_INPUT_MAX_CHARS) throw new ToolInputError(`${name} too long (>${RAW_INPUT_MAX_CHARS} chars)`);
  if (Array.isArray(v) && v.length > RAW_ARRAY_MAX_ITEMS) throw new ToolInputError(`${name} has too many items (>${RAW_ARRAY_MAX_ITEMS})`);
}

export function normalizeTerms(v: unknown): string[] {
  guardRaw(v, "terms");
  let arr: unknown[];
  if (typeof v === "string") arr = v.split(/\s+/);
  else if (Array.isArray(v)) arr = v;
  else throw new ToolInputError("terms must be an array of strings (or a single string)");
  const out: string[] = [];
  for (const t of arr) {
    if (typeof t !== "string") throw new ToolInputError("terms items must be strings");
    const s = t.trim();
    if (!s) continue;
    if (s.length > LIMITS.termLen) throw new ToolInputError(`term too long (>${LIMITS.termLen}): ${JSON.stringify(s.slice(0, 20))}…`);
    out.push(s);
  }
  if (out.length === 0) throw new ToolInputError("terms must contain at least one non-empty keyword");
  if (out.length > LIMITS.termsMax) throw new ToolInputError(`too many terms (${out.length} > ${LIMITS.termsMax})`);
  return out;
}

export function normalizeInt(v: unknown, name: string, min: number, max: number, dflt: number): number {
  if (v === undefined || v === null) return dflt;
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) n = parseInt(v, 10);
  else throw new ToolInputError(`${name} must be an integer`);
  if (!Number.isInteger(n)) throw new ToolInputError(`${name} must be an integer`);
  if (n < min || n > max) throw new ToolInputError(`${name} out of range [${min}, ${max}]: ${n}`);
  return n;
}

/** slug 정규화: 양끝 공백·`[[`·`]]`·`|표시`·`#섹션`·`.md`·`wiki/…/` 접두 제거. 그 후 검증.
 *  허용 문자는 "위험 문자만 금지" 방식: 경로 구분자(`/`·`\`)·`..`·제어문자(`\p{Cc}`, NUL 포함) 금지, 길이 ≤120.
 *  (원안 `^[\p{L}\p{N}._\- ]+$` 는 wiki_expand 가 돌려주는 기호 포함 slug(`zz-🦀-crab`, `zz-￦-won`)를 wiki_pack 이 거부하게
 *  만들어 라우팅 흐름을 끊었다 — P2 단위테스트 검출. 경계는 walk 인덱스 조회 + realpath 가 보장하므로 문자 클래스로 막을 필요가 없다.)
 *  `wiki/…/` 접두 제거는 `.`·`..` 세그먼트가 없을 때만 — `wiki/../x` 가 `x` 로 재해석되던 결함(P2 단위테스트 검출) 방지. */
export function normalizeSlug(v: unknown): string {
  if (typeof v !== "string") throw new ToolInputError("slug must be a string");
  guardRaw(v, "slug");
  let s = v.trim();
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  s = s.split("|")[0].split("#")[0].trim();
  if (s.endsWith(".md")) s = s.slice(0, -3);
  const m = /^wiki\/(?:(?!\.\.?\/)[^/]+\/)*([^/]+)$/.exec(s);
  if (m && !s.split("/").some((seg) => seg === "." || seg === "..")) s = m[1];
  s = s.trim();
  if (!s) throw new ToolInputError("slug is empty");
  if (s.length > LIMITS.slugLen) throw new ToolInputError(`slug too long (>${LIMITS.slugLen})`);
  if (s.includes("/") || s.includes("\\") || s.includes("..")) throw new ToolInputError(`slug must not contain path separators or '..': ${JSON.stringify(s)}`);
  if (/\p{Cc}/u.test(s)) throw new ToolInputError(`slug has control characters: ${JSON.stringify(s)}`);
  // URL 인코딩된 경로 문자(%2e %2f %5c)는 디코드하지 않지만 방어적으로 거부 — 조회 실패가 아니라 검증 오류로 알린다
  if (/%(2e|2f|5c)/i.test(s)) throw new ToolInputError(`slug must not contain URL-encoded path characters: ${JSON.stringify(s)}`);
  return s;
}

export function normalizeSlugs(v: unknown): string[] {
  guardRaw(v, "slugs");
  let arr: unknown[];
  if (typeof v === "string") arr = v.split(/[,\s]+/);
  else if (Array.isArray(v)) arr = v;
  else throw new ToolInputError("slugs must be an array of strings");
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== "string") throw new ToolInputError("slugs items must be strings"); // 리뷰: 비문자 항목을 조용히 버리지 않는다
    if (x.trim() === "") continue;
    out.push(normalizeSlug(x));
  }
  if (out.length === 0) throw new ToolInputError("slugs must contain at least one slug");
  if (out.length > LIMITS.slugsMax) throw new ToolInputError(`too many slugs (${out.length} > ${LIMITS.slugsMax})`);
  return out;
}

/** 텍스트 상한 적용 (P2-10) — UTF-8 바이트 기준, 코드포인트(서로게이트 쌍) 경계 보존(리뷰: lone surrogate 방지). */
export const TRUNC_MARKER = "\n…[truncated at 200 KB]\n";
export function capText(text: string, limit = TEXT_LIMIT): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= limit) return { text, truncated: false };
  // 마커도 예산에 포함(codex 2차 #4: 응답 전체 ≤ limit). 바이트 예산 안에서 자를 UTF-16 인덱스를 선형 누적으로 찾는다.
  const budget = Math.max(0, limit - Buffer.byteLength(TRUNC_MARKER, "utf8"));
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + len > budget) break;
    bytes += len;
    i += cp > 0xffff ? 2 : 1;
  }
  return { text: text.slice(0, i) + TRUNC_MARKER, truncated: true };
}

/** 구조화 응답(pack pages)도 같은 바이트 예산으로 자른다(리뷰 BLOCKER: text 만 자르면 structuredContent 가 우회). 페이지 단위로
 *  뒤에서부터 떨어뜨리고, 마지막 남은 페이지의 claims/relations 는 줄 단위로 줄인다. */
export function capPages<T extends { claims: string[]; relations: string[]; summary: string }>(pages: T[], limit = TEXT_LIMIT): { pages: T[]; truncated: boolean } {
  const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");
  if (size(pages) <= limit) return { pages, truncated: false };
  const out = pages.map((p) => ({ ...p }));
  while (out.length > 1 && size(out) > limit) out.pop();
  const last = out[0];
  while (size(out) > limit && (last.claims.length > 0 || last.relations.length > 0)) {
    if (last.relations.length > 0) last.relations = last.relations.slice(0, -1);
    else last.claims = last.claims.slice(0, -1);
  }
  if (size(out) > limit) last.summary = capText(last.summary, Math.max(1024, limit / 2)).text;
  return { pages: out, truncated: true };
}

/** JSON Schema **부분집합** 런타임 검증기(리뷰 MAJOR: 저수준 Server 는 outputSchema 를 검증하지 않음 → 응답 직전 fail-closed).
 *  지원 키워드 = 우리가 스키마에 쓰는 것만: type·properties·required·items·enum·minimum·maximum·minItems·maxItems·minLength·maxLength. */
export function validateSubset(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type as string | undefined;
  const isInt = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v);
  if (t === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: expected object`];
    const obj = value as Record<string, unknown>;
    // required: 키 부재뿐 아니라 명시적 undefined 도 누락으로 본다(JSON 직렬화에서 사라지므로 — 3차 테스트 검토 지적)
    for (const r of (schema.required as string[] | undefined) ?? []) if (obj[r] === undefined) errs.push(`${path}.${r}: required`);
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue; // 옵셔널 필드의 명시적 undefined 는 JSON 직렬화에서 사라짐 → 검사 생략(agy 2차 MAJOR-3)
      if (k in props) errs.push(...validateSubset(props[k], v, `${path}.${k}`));
      else if (schema.properties) errs.push(`${path}.${k}: unexpected property`); // 내부 검증은 strict(codex 2차 #8) — tools/list 스키마에는 additionalProperties 를 싣지 않는다
    }
  } else if (t === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.minItems !== undefined && value.length < (schema.minItems as number)) errs.push(`${path}: minItems`);
    if (schema.maxItems !== undefined && value.length > (schema.maxItems as number)) errs.push(`${path}: maxItems`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateSubset(schema.items as JsonSchema, v, `${path}[${i}]`)));
  } else if (t === "string") {
    if (typeof value !== "string") return [`${path}: expected string`];
    if (schema.minLength !== undefined && value.length < (schema.minLength as number)) errs.push(`${path}: minLength`);
    if (schema.maxLength !== undefined && value.length > (schema.maxLength as number)) errs.push(`${path}: maxLength`);
  } else if (t === "integer" || t === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (t === "integer" && !isInt(value))) return [`${path}: expected ${t}`];
    if (schema.minimum !== undefined && value < (schema.minimum as number)) errs.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > (schema.maximum as number)) errs.push(`${path}: maximum`);
  } else if (t === "boolean") {
    if (typeof value !== "boolean") return [`${path}: expected boolean`];
  }
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) errs.push(`${path}: not in enum`);
  return errs;
}

export function suggestedNext(max: number, rerank: number): "wiki_pack" | "wiki_read_page" | "answer" {
  if (rerank > 0) return "wiki_pack";
  if (max <= 6) return "answer";
  return "wiki_read_page";
}

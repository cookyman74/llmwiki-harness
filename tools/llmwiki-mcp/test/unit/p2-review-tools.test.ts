/**
 * P2 외부 보안리뷰(2026-09-09) 수정 검증 — tools.ts 계층.
 *   capText(바이트 상한·코드포인트 경계) · capPages(structuredContent 예산) · validateSubset(outputSchema 런타임 검증)
 *   · normalizeSlug/normalizeSlugs(기호 허용·경로 문자 거부·비문자 항목 거부) · 도구별 Routing 줄(instructions 독립).
 * 각 it 제목은 리뷰 finding 을 그대로 적는다.
 */
import { describe, expect, it } from "vitest";
import { callTool, MAX_CONCURRENT_CALLS } from "../../src/server.js";
import { TEXT_LIMIT, TOOLS, TRUNC_MARKER, ToolInputError, capPages, capText, normalizeSlug, normalizeSlugs, validateSubset, type JsonSchema } from "../../src/tools.js";
import { FIXTURE_VAULT } from "./p2-helpers.js";

const MARK = "\n…[truncated at 200 KB]\n";
const body = (s: string): string => s.slice(0, -MARK.length);
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const MARK_BYTES = bytes(MARK); // 26 — codex 2차 #4: 마커도 예산 안(응답 전체 ≤ limit) → 본문 예산 = limit − 26
const BUDGET = TEXT_LIMIT - MARK_BYTES;
const roundTrips = (s: string): boolean => Buffer.from(s, "utf8").toString("utf8") === s;
const lastUnit = (s: string): number => s.charCodeAt(s.length - 1);

describe("review: capText is UTF-8 byte based and preserves code point boundaries", () => {
  it("codex r2 #4: TRUNC_MARKER is exported and the marker counts inside the byte budget (total ≤ TEXT_LIMIT)", () => {
    expect(TRUNC_MARKER).toBe(MARK);
    expect(MARK_BYTES).toBe(26);
    expect(BUDGET).toBe(TEXT_LIMIT - 26);
  });

  it("BLOCKER: 100,000-char Korean string (300 KB UTF-8) is truncated — UTF-16 length would have let 3x the budget through", () => {
    const s = "가".repeat(100_000);
    expect(s.length).toBeLessThan(TEXT_LIMIT); // 옛 구현(UTF-16 길이)은 여기서 절단하지 않았다
    expect(bytes(s)).toBe(300_000);
    const r = capText(s);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith(MARK)).toBe(true);
    expect(bytes(r.text)).toBeLessThanOrEqual(TEXT_LIMIT); // 마커 포함 전체가 상한 이내
    const b = body(r.text);
    expect(bytes(b)).toBeLessThanOrEqual(BUDGET);
    expect(bytes(b)).toBeGreaterThan(BUDGET - 3); // 3바이트 문자 경계에서 최대한 채움
    expect(b).toBe("가".repeat(Math.floor(BUDGET / 3)));
    expect(roundTrips(b)).toBe(true);
  });

  it("MAJOR: TEXT_LIMIT-1 ASCII + one emoji is cut WITHOUT a lone surrogate", () => {
    const s = "a".repeat(TEXT_LIMIT - 1) + "🦀";
    expect(bytes(s)).toBe(TEXT_LIMIT + 3);
    const r = capText(s);
    expect(r.truncated).toBe(true);
    const b = body(r.text);
    expect(b).toBe("a".repeat(BUDGET)); // ASCII 는 마커 예산(26B)을 뺀 만큼만 남고, 이모지는 통째로 떨어진다(반쪽 금지)
    expect(lastUnit(b) >= 0xd800 && lastUnit(b) <= 0xdbff).toBe(false);
    expect(roundTrips(b)).toBe(true);
    expect(bytes(r.text)).toBe(TEXT_LIMIT); // ASCII 라 정확히 상한까지 채움
  });

  it("MAJOR: emoji straddling the budget by 2 bytes is dropped whole (no half surrogate pair)", () => {
    const s = "a".repeat(BUDGET - 2) + "🦀" + "z".repeat(30); // 이모지가 본문 예산 경계(BUDGET)에 걸치고, 전체는 상한 초과
    expect(bytes(s)).toBe(TEXT_LIMIT + 6);
    const r = capText(s);
    expect(r.truncated).toBe(true);
    const b = body(r.text);
    expect(b).toBe("a".repeat(BUDGET - 2));
    expect(lastUnit(b) >= 0xd800 && lastUnit(b) <= 0xdbff).toBe(false);
    expect(roundTrips(b)).toBe(true);
    expect(bytes(r.text)).toBe(TEXT_LIMIT - 2);
    expect(bytes(r.text)).toBeLessThanOrEqual(TEXT_LIMIT);
  });

  it("emoji that fits exactly at the byte budget is kept and the text is untouched", () => {
    const s = "a".repeat(TEXT_LIMIT - 4) + "🦀";
    expect(bytes(s)).toBe(TEXT_LIMIT);
    const r = capText(s);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(s);
  });

  it("ASCII under the limit is returned untouched with truncated:false", () => {
    const s = "hello world\n".repeat(1000);
    const r = capText(s);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(s);
    expect(capText("")).toEqual({ text: "", truncated: false });
    expect(capText("a".repeat(TEXT_LIMIT))).toEqual({ text: "a".repeat(TEXT_LIMIT), truncated: false });
    expect(capText("a".repeat(TEXT_LIMIT + 1)).truncated).toBe(true);
  });

  it("custom limit: mixed Hangul/ASCII is cut on a code point boundary within the byte budget", () => {
    const s = "ab가나다" + "x".repeat(30); // 2 + 9 + 30 = 41 bytes
    expect(capText(s, 41)).toEqual({ text: s, truncated: false });
    const r = capText(s, MARK_BYTES + 10); // 본문 예산 10 바이트
    expect(body(r.text)).toBe("ab가나"); // 8 bytes; '다' 는 3바이트라 못 들어간다
    expect(r.truncated).toBe(true);
    expect(bytes(r.text)).toBe(8 + MARK_BYTES);
    expect(bytes(r.text)).toBeLessThanOrEqual(MARK_BYTES + 10);
  });
});

type Page = { slug: string; found: boolean; type: string; confidence: string; status: string; claims: string[]; summary: string; relations: string[] };
const mkPage = (i: number, claims: number, relations = 0, summary = "summary"): Page => ({
  slug: `p${i}`,
  found: true,
  type: "fact",
  confidence: "0.85",
  status: "active",
  claims: Array.from({ length: claims }, (_, k) => `claim ${i}-${k} ${"c".repeat(80)}`),
  summary,
  relations: Array.from({ length: relations }, (_, k) => `- uses :: [[r${k}]]`),
});
const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");

describe("review: capPages caps structuredContent.pages under the same byte budget", () => {
  it("BLOCKER: 30 pages with huge claims arrays are cut under budget with truncated:true (structuredContent must not bypass the text cap)", () => {
    const pages = Array.from({ length: 30 }, (_, i) => mkPage(i, 600, 5)); // 페이지당 ~55 KB → 총 ~1.6 MB
    expect(size(pages)).toBeGreaterThan(TEXT_LIMIT * 5);
    const r = capPages(pages);
    expect(r.truncated).toBe(true);
    expect(size(r.pages)).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(JSON.stringify(r.pages).length).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(r.pages.length).toBeGreaterThan(0);
    expect(r.pages.length).toBeLessThan(30);
    // 앞쪽 페이지가 순서대로 살아남는다(뒤에서부터 떨어뜨림), 살아남은 페이지의 스키마 필드는 온전
    const packSchema = TOOLS.find((t) => t.name === "wiki_pack")!.outputSchema;
    const pageSchema = ((packSchema.properties as Record<string, JsonSchema>).pages as { items: JsonSchema }).items;
    r.pages.forEach((p, i) => {
      expect(p.slug).toBe(`p${i}`);
      expect(validateSubset(pageSchema, p)).toEqual([]);
    });
    // 입력은 변형하지 않는다
    expect(pages.length).toBe(30);
    expect(pages[0].claims.length).toBe(600);
  });

  it("BLOCKER: a single page larger than the budget keeps the page but drops relations then claims from the end", () => {
    const [p] = [mkPage(0, 5000, 10)];
    expect(size([p])).toBeGreaterThan(TEXT_LIMIT);
    const r = capPages([p]);
    expect(r.truncated).toBe(true);
    expect(r.pages).toHaveLength(1);
    expect(size(r.pages)).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(r.pages[0].slug).toBe("p0");
    expect(r.pages[0].relations).toEqual([]); // relations 가 먼저 떨어진다
    expect(r.pages[0].claims.length).toBeGreaterThan(0);
    expect(r.pages[0].claims.length).toBeLessThan(5000);
    expect(r.pages[0].claims[0]).toBe(p.claims[0]); // 앞쪽 claim 보존
    expect(p.claims.length).toBe(5000); // 입력 무변형
    expect(p.relations.length).toBe(10);
  });

  it("BLOCKER: a single page whose summary alone exceeds the budget gets its summary capped (byte based, valid UTF-8)", () => {
    const p = mkPage(0, 0, 0, "가".repeat(100_000)); // 300 KB summary, claims 없음
    const r = capPages([p]);
    expect(r.truncated).toBe(true);
    expect(size(r.pages)).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(r.pages[0].summary.length).toBeLessThan(p.summary.length);
    expect(roundTrips(r.pages[0].summary)).toBe(true);
  });

  it("under-budget input is returned unchanged (same reference) with truncated:false", () => {
    const pages = Array.from({ length: 3 }, (_, i) => mkPage(i, 5, 2));
    const r = capPages(pages);
    expect(r.truncated).toBe(false);
    expect(r.pages).toBe(pages);
    expect(capPages([])).toEqual({ pages: [], truncated: false });
  });
});

describe("review: validateSubset — runtime JSON-Schema-subset validator used to fail-closed on outputSchema", () => {
  it("object: required keys are enforced, non-objects (array/null/string) are rejected, unknown keys are rejected (codex r2 #8 strict), explicit undefined is skipped (agy r2 MAJOR-3)", () => {
    const sch: JsonSchema = { type: "object", properties: { a: { type: "string" }, b: { type: "integer" } }, required: ["a", "b"] };
    expect(validateSubset(sch, { a: "x", b: 1 })).toEqual([]);
    expect(validateSubset(sch, { a: "x", b: 1, extra: true })).toEqual(["$.extra: unexpected property"]);
    expect(validateSubset(sch, { a: "x", b: 1, extra: undefined })).toEqual([]); // JSON 직렬화에서 사라지는 값은 검사 생략
    expect(validateSubset(sch, { a: "x" })).toEqual(["$.b: required"]);
    expect(validateSubset(sch, {})).toEqual(["$.a: required", "$.b: required"]);
    expect(validateSubset(sch, [])).toEqual(["$: expected object"]);
    expect(validateSubset(sch, null)).toEqual(["$: expected object"]);
    expect(validateSubset(sch, "str")).toEqual(["$: expected object"]);
    expect(validateSubset(sch, { a: 5, b: 1 })).toEqual(["$.a: expected string"]);
  });

  it("array: minItems/maxItems and per-item schema; non-arrays are rejected", () => {
    const sch: JsonSchema = { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 3 };
    expect(validateSubset(sch, [1, 2, 3])).toEqual([]);
    expect(validateSubset(sch, [])).toEqual(["$: minItems"]);
    expect(validateSubset(sch, [1, 2, 3, 4])).toEqual(["$: maxItems"]);
    expect(validateSubset(sch, [1, "2"])).toEqual(["$[1]: expected integer"]);
    expect(validateSubset(sch, { length: 1 })).toEqual(["$: expected array"]);
    expect(validateSubset(sch, "abc")).toEqual(["$: expected array"]);
  });

  it("string: minLength/maxLength; non-strings are rejected", () => {
    const sch: JsonSchema = { type: "string", minLength: 2, maxLength: 4 };
    expect(validateSubset(sch, "ab")).toEqual([]);
    expect(validateSubset(sch, "abcd")).toEqual([]);
    expect(validateSubset(sch, "a")).toEqual(["$: minLength"]);
    expect(validateSubset(sch, "abcde")).toEqual(["$: maxLength"]);
    expect(validateSubset(sch, 12)).toEqual(["$: expected string"]);
    expect(validateSubset(sch, null)).toEqual(["$: expected string"]);
  });

  it("integer vs number: 1.5 fails integer but passes number; NaN/Infinity/strings fail both; minimum/maximum enforced", () => {
    const int: JsonSchema = { type: "integer", minimum: 1, maximum: 10 };
    const num: JsonSchema = { type: "number", minimum: 0.5, maximum: 2.5 };
    expect(validateSubset(int, 5)).toEqual([]);
    expect(validateSubset(int, 1.5)).toEqual(["$: expected integer"]);
    expect(validateSubset(num, 1.5)).toEqual([]);
    expect(validateSubset(int, 0)).toEqual(["$: minimum"]);
    expect(validateSubset(int, 11)).toEqual(["$: maximum"]);
    expect(validateSubset(num, 0.25)).toEqual(["$: minimum"]);
    expect(validateSubset(num, 3)).toEqual(["$: maximum"]);
    for (const bad of [NaN, Infinity, -Infinity, "3", null, true]) {
      expect(validateSubset(int, bad)).toEqual(["$: expected integer"]);
      expect(validateSubset(num, bad)).toEqual(["$: expected number"]);
    }
  });

  it("boolean: only true/false pass — 'true', 0, 1, null fail", () => {
    const sch: JsonSchema = { type: "boolean" };
    expect(validateSubset(sch, true)).toEqual([]);
    expect(validateSubset(sch, false)).toEqual([]);
    for (const bad of ["true", 0, 1, null, undefined, {}]) expect(validateSubset(sch, bad)).toEqual(["$: expected boolean"]);
  });

  it("enum: membership is enforced on top of the type check", () => {
    const sch: JsonSchema = { type: "string", enum: ["seed", "1hop", "moc"] };
    expect(validateSubset(sch, "moc")).toEqual([]);
    expect(validateSubset(sch, "MOC")).toEqual(["$: not in enum"]);
    expect(validateSubset(sch, 3)).toEqual(["$: expected string"]);
  });

  it("nested: object → array → object paths are reported with their location", () => {
    const sch: JsonSchema = {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object", properties: { slug: { type: "string" }, tier: { type: "string", enum: ["seed"] } }, required: ["slug", "tier"] } },
        truncated: { type: "boolean" },
      },
      required: ["rows", "truncated"],
    };
    expect(validateSubset(sch, { rows: [{ slug: "a", tier: "seed" }], truncated: false })).toEqual([]);
    expect(validateSubset(sch, { rows: [{ slug: "a", tier: "seed" }, { slug: 1 }], truncated: "no" })).toEqual(["$.rows[1].tier: required", "$.rows[1].slug: expected string", "$.truncated: expected boolean"]); // required 검사가 속성 검사보다 먼저
  });

  it("schema without type only checks enum (defensive no-op for unknown keywords)", () => {
    expect(validateSubset({ description: "anything" }, { a: 1 })).toEqual([]);
    expect(validateSubset({ enum: [1, 2] }, 3)).toEqual(["$: not in enum"]);
  });
});

describe("review: server output validation (outputSchema fail-closed)", () => {
  const schemaOf = (name: string): JsonSchema => TOOLS.find((t) => t.name === name)!.outputSchema;

  it("MAJOR: a deliberately wrong structuredContent is rejected by every tool's outputSchema", () => {
    expect(validateSubset(schemaOf("wiki_search"), { text: "x" })).toEqual(["$.rows: required", "$.matched: required", "$.truncated: required"]);
    expect(validateSubset(schemaOf("wiki_search"), { text: "x", rows: [{ distinct: "1", total: 1, slug: "s", type: "t" }], matched: 1.5, truncated: true })).toEqual(["$.rows[0].distinct: expected integer", "$.matched: expected integer"]);
    expect(validateSubset(schemaOf("wiki_expand"), { text: "x", rows: [{ tier: "2hop", slug: "s", type: "t" }], suggested_next: "wiki_nope", truncated: false })).toEqual(["$.rows[0].tier: not in enum", "$.suggested_next: not in enum"]);
    expect(validateSubset(schemaOf("wiki_pack"), { text: "x", pages: [{ slug: "s" }], truncated: false }).length).toBeGreaterThan(0);
    expect(validateSubset(schemaOf("wiki_read_page"), { slug: "s", resolved_from_alias: false, path: "p", frontmatter: {}, text: "t", truncated: false })).toEqual(["$.frontmatter.type: required", "$.frontmatter.confidence: required", "$.frontmatter.status: required"]);
  });

  it("MAJOR: the 4 real tools' structuredContent passes the exported validator via callTool (no client-side validation involved)", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["wiki_search", { terms: ["rerank"] }],
      ["wiki_expand", { terms: ["rerank"], rerank: 11 }],
      ["wiki_pack", { slugs: ["concept-reranking"] }],
      ["wiki_read_page", { slug: "concept-reranking" }],
    ];
    for (const [name, args] of cases) {
      const r = await callTool(FIXTURE_VAULT, name, args);
      expect(r.isError, name).toBeFalsy();
      expect(r.structuredContent, name).toBeDefined();
      expect(validateSubset(schemaOf(name), r.structuredContent), name).toEqual([]);
    }
  });

  it("unknown tool name → isError (not a thrown protocol error)", async () => {
    const r = await callTool(FIXTURE_VAULT, "wiki_nope", {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/unknown tool: wiki_nope/);
    expect(r.structuredContent).toBeUndefined();
  });

  it("MAX_CONCURRENT_CALLS is exported and equals 4", () => {
    expect(MAX_CONCURRENT_CALLS).toBe(4);
  });
});

describe("review: normalizeSlug / normalizeSlugs", () => {
  it("MINOR: normalizeSlugs rejects non-string items ([123, 'valid']) with ToolInputError instead of silently dropping them", () => {
    expect(() => normalizeSlugs([123, "valid"])).toThrow(ToolInputError);
    expect(() => normalizeSlugs([123, "valid"])).toThrow(/slugs items must be strings/);
    expect(() => normalizeSlugs(["valid", null])).toThrow(ToolInputError);
    expect(() => normalizeSlugs(["valid", { slug: "x" }])).toThrow(ToolInputError);
    expect(normalizeSlugs(["valid", " other "])).toEqual(["valid", "other"]);
  });

  it("MAJOR: normalizeSlug accepts symbol slugs wiki_expand can return (zz-🦀-crab, zz-￦-won) — routing flow must not break", () => {
    expect(normalizeSlug("zz-🦀-crab")).toBe("zz-🦀-crab");
    expect(normalizeSlug("zz-￦-won")).toBe("zz-￦-won");
    expect(normalizeSlug("[[zz-🦀-crab|display]]")).toBe("zz-🦀-crab");
    expect(normalizeSlug("wiki/L3-semantic/zz-🦀-crab.md")).toBe("zz-🦀-crab");
    expect(normalizeSlugs("zz-🦀-crab, zz-￦-won")).toEqual(["zz-🦀-crab", "zz-￦-won"]);
  });

  it("MAJOR: 'wiki/../x' and 'wiki/./x' are rejected (no prefix strip when a '.'/'..' segment exists)", () => {
    expect(() => normalizeSlug("wiki/../x")).toThrow(ToolInputError);
    expect(() => normalizeSlug("wiki/../x")).toThrow(/path separators|'\.\.'/);
    expect(() => normalizeSlug("wiki/./x")).toThrow(ToolInputError);
    expect(() => normalizeSlug("wiki/L3-semantic/../x")).toThrow(ToolInputError);
    expect(() => normalizeSlug("wiki/../wiki/x")).toThrow(ToolInputError);
    expect(normalizeSlug("wiki/L3-semantic/x")).toBe("x"); // 정상 접두 제거는 유지
  });

  it("MINOR: URL-encoded path characters (%2e%2e%2fx, %5c) are rejected as a validation error, not a lookup miss", () => {
    expect(() => normalizeSlug("%2e%2e%2fx")).toThrow(ToolInputError);
    expect(() => normalizeSlug("%2e%2e%2fx")).toThrow(/URL-encoded/);
    expect(() => normalizeSlug("a%2Fb")).toThrow(/URL-encoded/);
    expect(() => normalizeSlug("a%5Cb")).toThrow(/URL-encoded/);
    expect(normalizeSlug("100%-done")).toBe("100%-done"); // 다른 % 는 허용
  });

  it("MINOR: control characters (NUL, ESC) are rejected; separators and '..' too", () => {
    expect(() => normalizeSlug("a b")).toThrow(ToolInputError);
    expect(() => normalizeSlug("a b")).toThrow(/control characters/);
    expect(() => normalizeSlug("ab")).toThrow(/control characters/);
    expect(() => normalizeSlug("a\tb")).toThrow(/control characters/);
    expect(() => normalizeSlug("a\\b")).toThrow(/path separators/);
    expect(() => normalizeSlug("a/b")).toThrow(/path separators/);
    expect(() => normalizeSlug("..")).toThrow(ToolInputError);
    expect(() => normalizeSlug("a..b")).toThrow(ToolInputError);
    expect(() => normalizeSlug(42)).toThrow(/slug must be a string/);
  });
});

describe("review: routing without instructions — per-tool 'Routing:' last line", () => {
  const lastLine = (name: string): string => {
    const lines = TOOLS.find((t) => t.name === name)!.description.split("\n");
    return lines[lines.length - 1];
  };

  it("MINOR: every tool description ends with a 'Routing:' line and the lines differ per tool", () => {
    const lines = TOOLS.map((t) => lastLine(t.name));
    for (const ln of lines) expect(ln.startsWith("Routing:")).toBe(true);
    expect(new Set(lines).size).toBe(TOOLS.length); // 동일 문장 반복 금지 — 위치를 드러내지 못한다
  });

  it("wiki_expand's line is the entry point: mentions wiki_pack, wiki_read_page and suggested_next", () => {
    const ln = lastLine("wiki_expand");
    expect(ln).toContain("wiki_pack");
    expect(ln).toContain("wiki_read_page");
    expect(ln).toContain("suggested_next");
    expect(ln).toContain("FIRST");
  });

  it("wiki_search → 'fallback', wiki_pack → 'rerank=11', wiki_read_page → 'max=8'", () => {
    expect(lastLine("wiki_search")).toContain("fallback");
    expect(lastLine("wiki_pack")).toContain("rerank=11");
    expect(lastLine("wiki_read_page")).toContain("max=8");
  });
});

/**
 * P2-09 — outputSchema ↔ structuredContent 일치 (DESIGN §3 공통).
 * tools/list 의 outputSchema 로 각 도구의 실제 structuredContent 를 검증한다. 의존성 추가 대신 우리가 쓰는 JSON Schema
 * 부분집합(type/properties/required/items/enum/minimum/maximum/minItems/maxItems/minLength/maxLength)만 구현한 소형 검증기를 쓴다.
 * 또한 content[0].text 가 비어있지 않고 structuredContent.text 와 같은 문자열인지(텍스트가 1차 표현) 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_VAULT, connect, text, type Connected } from "./p2-helpers.js";

type Schema = Record<string, unknown>;

/** JSON Schema 부분집합 검증기 — 오류 경로 목록을 돌려준다(빈 배열 = 유효). */
export function validate(schema: Schema, value: unknown, at = "$"): string[] {
  const errs: string[] = [];
  const type = schema.type as string | undefined;
  if (type !== undefined) {
    const ok =
      type === "object"
        ? typeof value === "object" && value !== null && !Array.isArray(value)
        : type === "array"
          ? Array.isArray(value)
          : type === "string"
            ? typeof value === "string"
            : type === "integer"
              ? typeof value === "number" && Number.isInteger(value)
              : type === "number"
                ? typeof value === "number" && Number.isFinite(value)
                : type === "boolean"
                  ? typeof value === "boolean"
                  : false;
    if (!ok) return [`${at}: expected ${type}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`];
  }
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${at}: ${value} < minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${at}: ${value} > maximum ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errs.push(`${at}: shorter than minLength ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errs.push(`${at}: longer than maxLength ${schema.maxLength}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errs.push(`${at}: fewer than minItems ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errs.push(`${at}: more than maxItems ${schema.maxItems}`);
    if (schema.items && typeof schema.items === "object") value.forEach((v, i) => errs.push(...validate(schema.items as Schema, v, `${at}[${i}]`)));
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (!(k in obj)) errs.push(`${at}.${k}: required`);
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const [k, sub] of Object.entries(props)) if (k in obj) errs.push(...validate(sub, obj[k], `${at}.${k}`));
  }
  return errs;
}

let c: Connected;
let outputSchemas: Map<string, Schema>;

beforeAll(async () => {
  c = await connect(FIXTURE_VAULT, { structured: true });
  const { tools } = await c.client.listTools();
  outputSchemas = new Map(tools.map((t) => [t.name, (t.outputSchema ?? {}) as Schema]));
});
afterAll(async () => c.close());

const CALLS: { name: string; args: Record<string, unknown>; extra?: (sc: Record<string, unknown>) => void }[] = [
  {
    name: "wiki_search",
    args: { terms: ["벡터", "인덱스"], top: 8 },
    extra: (sc) => {
      expect((sc.rows as unknown[]).length).toBeGreaterThan(0);
      expect(sc.truncated).toBe(false);
    },
  },
  {
    name: "wiki_expand",
    args: { terms: ["rerank"], max: 15, top_seed: 6 },
    extra: (sc) => {
      expect(sc.suggested_next).toBe("wiki_read_page");
      const rows = sc.rows as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(typeof r.refs).toBe("number"); // rerank=0 → refs 열
    },
  },
  {
    name: "wiki_expand",
    args: { terms: ["rerank"], max: 20, rerank: 11 },
    extra: (sc) => {
      expect(sc.suggested_next).toBe("wiki_pack");
      const rows = sc.rows as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(typeof r.score).toBe("number"); // rerank>0 → score 열
    },
  },
  {
    name: "wiki_expand",
    args: { terms: ["rerank"], max: 6 },
    extra: (sc) => expect(sc.suggested_next).toBe("answer"),
  },
  {
    name: "wiki_expand",
    args: { terms: ["ZZZNOPE"] },
    extra: (sc) => {
      expect(sc.rows).toEqual([]);
      // MCP 텍스트는 리트리벌 텍스트 + 라우팅 힌트 1줄(codex 3차 MAJOR-5). 시드가 없어도 힌트는 붙는다.
      expect(sc.suggested_next).toBe("wiki_read_page"); // max 기본 15 · rerank 0
      expect(sc.text).toBe("no lexical seed for: ZZZNOPE\nsuggested_next: wiki_read_page\n");
    },
  },
  {
    name: "wiki_pack",
    args: { slugs: ["concept-reranking", "fact-latency-budget-old", "entity-northwind-team", "nonexistent-slug"] },
    extra: (sc) => {
      const pages = sc.pages as Record<string, unknown>[];
      expect(pages.map((p) => p.found)).toEqual([true, true, true, false]);
      expect(pages[1].status).toBe("stale");
      expect((pages[2].summary as string).length).toBeGreaterThan(0); // claim 없는 페이지 → 요약
    },
  },
  {
    name: "wiki_read_page",
    args: { slug: "fact-latency-budget-old" },
    extra: (sc) => {
      const fm = sc.frontmatter as Record<string, unknown>;
      expect(fm.status).toBe("stale");
      expect(fm.superseded_by).toBe("[[fact-latency-budget]]"); // 겉 따옴표 제거
      expect(sc.path).toBe("wiki/L3-semantic/fact-latency-budget-old.md");
      expect(sc.resolved_from_alias).toBe(false);
    },
  },
  {
    name: "wiki_read_page",
    args: { slug: "procedure-no-type" },
    extra: (sc) => expect((sc.frontmatter as Record<string, unknown>).type).toBe("L4-procedural"), // type 없음 → 부모 디렉터리명
  },
];

describe("P2-09 outputSchema ↔ structuredContent", () => {
  it("P2-09 픽스처 tools/list 는 4개 도구 모두 outputSchema 를 선언한다", () => {
    expect([...outputSchemas.keys()].sort()).toEqual(["wiki_expand", "wiki_pack", "wiki_read_page", "wiki_search"]);
    for (const s of outputSchemas.values()) expect(s.type).toBe("object");
  });

  for (const tc of CALLS) {
    it(`P2-09 ${tc.name}(${JSON.stringify(tc.args)}) structuredContent 가 outputSchema 에 부합하고 text 와 일치`, async () => {
      const r = await c.call(tc.name, tc.args);
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toBeDefined();
      const sc = r.structuredContent as Record<string, unknown>;
      expect(validate(outputSchemas.get(tc.name) as Schema, sc)).toEqual([]);
      expect(typeof text(r)).toBe("string");
      expect(text(r).length).toBeGreaterThan(0);
      expect(text(r)).toBe(sc.text);
      expect(text(r).endsWith("\n")).toBe(true);
      tc.extra?.(sc);
    });
  }

  it("P2-09 검증기 자체 점검 — 어긋난 값은 잡아낸다", () => {
    const s = outputSchemas.get("wiki_expand") as Schema;
    expect(validate(s, { text: "x", rows: [{ tier: "bogus", slug: "a", type: "b" }], suggested_next: "answer", truncated: false })).not.toEqual([]);
    expect(validate(s, { text: "x", rows: [], suggested_next: "nope", truncated: false })).not.toEqual([]);
    expect(validate(s, { text: "x", rows: [], suggested_next: "answer" })).toEqual(["$.truncated: required"]);
    expect(validate(s, { text: "x", rows: [{ tier: "seed", slug: "a", type: "b", refs: 1.5 }], suggested_next: "answer", truncated: false })).toEqual([
      "$.rows[0].refs: expected integer, got number",
    ]);
  });
});

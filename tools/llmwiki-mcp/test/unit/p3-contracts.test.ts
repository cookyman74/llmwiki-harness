/**
 * P3-28+ (agy P2 2차 m5) — `TOOLS[].outputSchema` ↔ `src/contracts.ts` TS 인터페이스의 정적 연결 검증.
 *
 * 정적 절반은 컴파일러가 한다: `server.ts` 의 각 분기가 `const sc: XStructured = {…}` 를 만들므로 필드 누락·오타·타입
 * 불일치는 `tsc` 에서 실패한다(수동 확인: `matched` → `matchedd` 로 바꾸면 TS2561).
 *
 * 이 파일은 **나머지 절반** — 인터페이스와 스키마가 조용히 갈라지는 것을 막는다:
 *  - 인터페이스의 **필수 키 집합**(`?` 없는 필드) == 스키마 `required` 배열
 *  - 인터페이스의 전체 키 집합 == 스키마 `properties` 키 집합
 * 키 목록은 `Record<RequiredKeys<T>, true>` 로 선언하므로, 인터페이스에 필드를 추가/삭제하면 **이 파일이 먼저 컴파일
 * 실패**하고(리터럴 불완전/초과), 고쳐 넣으면 스키마와 비교하는 런타임 단정이 드리프트를 잡는다.
 */
import { describe, expect, it } from "vitest";
import type {
  ExpandStructured,
  ExpandStructuredRow,
  PackStructured,
  PackStructuredPage,
  ReadPageStructured,
  ReadPageStructuredFrontmatter,
  SearchStructured,
  SearchStructuredRow,
  StructuredToolName,
} from "../../src/contracts.js";
import { TOOLS, type JsonSchema } from "../../src/tools.js";
import { FIXTURE_VAULT } from "./p2-helpers.js";
import { callTool } from "../../src/server.js";

/** `?` 가 없는(= undefined 를 못 받는) 키만. */
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
/** 정확히 필수 키 전부를 나열해야 하는 리터럴 타입(누락·초과 모두 컴파일 오류). */
type RequiredKeySet<T> = Record<RequiredKeys<T>, true>;
type OptionalKeySet<T> = Record<OptionalKeys<T>, true>;

const schemaOf = (name: string): JsonSchema => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no such tool: ${name}`);
  return t.outputSchema;
};
const sub = (schema: JsonSchema, ...keys: string[]): JsonSchema => {
  let cur = schema;
  for (const k of keys) {
    const next = k === "items" ? cur.items : (cur.properties as Record<string, JsonSchema> | undefined)?.[k];
    if (!next) throw new Error(`missing schema node: ${keys.join(".")}`);
    cur = next as JsonSchema;
  }
  return cur;
};

interface Node {
  label: string;
  schema: JsonSchema;
  required: Record<string, true>;
  optional: Record<string, true>;
}

const EXPAND = schemaOf("wiki_expand");
const PACK = schemaOf("wiki_pack");
const READ = schemaOf("wiki_read_page");
const SEARCH = schemaOf("wiki_search");

// 각 노드의 키 목록은 **인터페이스에서 유도된 타입**으로 고정된다 — 인터페이스가 바뀌면 이 리터럴이 컴파일 실패한다.
const NODES: Node[] = [
  {
    label: "wiki_expand.outputSchema ↔ ExpandStructured",
    schema: EXPAND,
    required: { text: true, rows: true, suggested_next: true, truncated: true } satisfies RequiredKeySet<ExpandStructured>,
    optional: {} satisfies OptionalKeySet<ExpandStructured>,
  },
  {
    label: "wiki_expand.rows.items ↔ ExpandStructuredRow",
    schema: sub(EXPAND, "rows", "items"),
    required: { tier: true, slug: true, type: true } satisfies RequiredKeySet<ExpandStructuredRow>,
    optional: { refs: true, score: true } satisfies OptionalKeySet<ExpandStructuredRow>,
  },
  {
    label: "wiki_pack.outputSchema ↔ PackStructured",
    schema: PACK,
    required: { text: true, pages: true, truncated: true } satisfies RequiredKeySet<PackStructured>,
    optional: {} satisfies OptionalKeySet<PackStructured>,
  },
  {
    label: "wiki_pack.pages.items ↔ PackStructuredPage",
    schema: sub(PACK, "pages", "items"),
    required: { slug: true, found: true, type: true, confidence: true, status: true, claims: true, summary: true, relations: true } satisfies RequiredKeySet<PackStructuredPage>,
    optional: {} satisfies OptionalKeySet<PackStructuredPage>,
  },
  {
    label: "wiki_read_page.outputSchema ↔ ReadPageStructured",
    schema: READ,
    required: { slug: true, resolved_from_alias: true, path: true, frontmatter: true, text: true, truncated: true } satisfies RequiredKeySet<ReadPageStructured>,
    optional: {} satisfies OptionalKeySet<ReadPageStructured>,
  },
  {
    label: "wiki_read_page.frontmatter ↔ ReadPageStructuredFrontmatter",
    schema: sub(READ, "frontmatter"),
    required: { type: true, confidence: true, status: true } satisfies RequiredKeySet<ReadPageStructuredFrontmatter>,
    optional: { superseded_by: true, last_confirmed: true } satisfies OptionalKeySet<ReadPageStructuredFrontmatter>,
  },
  {
    label: "wiki_search.outputSchema ↔ SearchStructured",
    schema: SEARCH,
    required: { text: true, rows: true, matched: true, truncated: true } satisfies RequiredKeySet<SearchStructured>,
    optional: {} satisfies OptionalKeySet<SearchStructured>,
  },
  {
    label: "wiki_search.rows.items ↔ SearchStructuredRow",
    schema: sub(SEARCH, "rows", "items"),
    required: { distinct: true, total: true, slug: true, type: true } satisfies RequiredKeySet<SearchStructuredRow>,
    optional: {} satisfies OptionalKeySet<SearchStructuredRow>,
  },
];

describe("P3-28+ outputSchema ↔ TS 인터페이스", () => {
  for (const n of NODES) {
    it(`${n.label} — 필수 키 == 스키마 required, 전체 키 == 스키마 properties`, () => {
      const schemaRequired = ((n.schema.required as string[] | undefined) ?? []).slice().sort();
      const schemaProps = Object.keys((n.schema.properties as Record<string, JsonSchema> | undefined) ?? {}).sort();
      expect(Object.keys(n.required).sort()).toEqual(schemaRequired);
      expect([...Object.keys(n.required), ...Object.keys(n.optional)].sort()).toEqual(schemaProps);
      // 옵셔널 키는 required 에 없어야 한다(양방향)
      for (const k of Object.keys(n.optional)) expect(schemaRequired).not.toContain(k);
    });
  }

  it("StructuredByTool 이 TOOLS 4개를 정확히 덮는다", () => {
    const covered: Record<StructuredToolName, true> = { wiki_expand: true, wiki_pack: true, wiki_read_page: true, wiki_search: true };
    expect(Object.keys(covered).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("실제 structuredContent 의 키가 인터페이스에 선언된 키를 벗어나지 않는다", async () => {
    const calls: { name: string; args: Record<string, unknown>; node: string }[] = [
      { name: "wiki_expand", args: { terms: ["rerank"], max: 15 }, node: "wiki_expand.outputSchema ↔ ExpandStructured" },
      { name: "wiki_pack", args: { slugs: ["concept-reranking"] }, node: "wiki_pack.outputSchema ↔ PackStructured" },
      { name: "wiki_read_page", args: { slug: "fact-latency-budget-old" }, node: "wiki_read_page.outputSchema ↔ ReadPageStructured" },
      { name: "wiki_search", args: { terms: ["벡터"] }, node: "wiki_search.outputSchema ↔ SearchStructured" },
    ];
    for (const c of calls) {
      const r = await callTool(FIXTURE_VAULT, c.name, c.args);
      expect(r.isError, c.name).toBeFalsy();
      const sc = r.structuredContent as Record<string, unknown>;
      const n = NODES.find((x) => x.label === c.node) as Node;
      const declared = new Set([...Object.keys(n.required), ...Object.keys(n.optional)]);
      for (const k of Object.keys(sc)) expect(declared.has(k), `${c.name}.${k} not declared in the interface`).toBe(true);
      for (const k of Object.keys(n.required)) expect(sc[k], `${c.name}.${k}`).not.toBeUndefined();
    }
  });
});

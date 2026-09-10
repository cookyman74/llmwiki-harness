/**
 * P3-27+ (codex P2 2차 #8) — **독립** JSON Schema 검증기(ajv, devDependency)로 스키마와 응답을 교차 검증한다.
 *
 * 왜: 지금까지 스키마 검증은 우리가 손으로 쓴 `validateSubset`(src/tools.ts) 하나였다. 서버의 fail-closed 검사도,
 * 테스트의 단정도 같은 코드였으므로 **스키마가 틀리고 검증기도 같은 방식으로 틀리면 둘 다 통과**한다(리뷰 지적).
 * 여기서는 외부 구현(ajv)으로:
 *  1) 커밋된 `develop_docs/v0.8.6/todo/review/P2-tools-list.json` 덤프가 라이브 `TOOLS` 와 일치하는지(드리프트 검사),
 *  2) 8개 스키마(input·output ×4)를 ajv `strict: true` 로 **컴파일**(스키마 자체가 틀리면 실패),
 *  3) 픽스처 볼트에 실제 `callTool()` 을 걸어 나온 `structuredContent` 를 **ajv 컴파일 검증기**로 검사,
 *  4) 일부러 틀린 객체를 ajv 와 `validateSubset` 양쪽에 먹여 **두 검증기가 같은 판정을 내는지**(교차 검증),
 *  5) 다중 클라이언트 호환 금지 키워드(anyOf/oneOf/allOf/$ref/$defs/const/default/additionalProperties/format) 부재
 * 를 확인한다.
 *
 * ajv 는 devDependency 전용 — 런타임 의존성은 `@modelcontextprotocol/sdk` 하나로 유지된다(scaffold.test.ts 가 단정).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import { beforeAll, describe, expect, it } from "vitest";
import { callTool } from "../../src/server.js";
import { SERVER_INSTRUCTIONS, TOOLS, validateSubset, type JsonSchema } from "../../src/tools.js";
import { FIXTURE_VAULT, PKG_DIR } from "./p2-helpers.js";

const DUMP_PATH = path.join(PKG_DIR, "..", "..", "develop_docs", "v0.8.6", "todo", "review", "P2-tools-list.json");
const REGEN = `regenerate it: cd tools/llmwiki-mcp && npm run build && node scripts/dump-tools-list.mjs`;

interface DumpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}
interface Dump {
  instructions: string;
  tools: DumpTool[];
}

const dump = JSON.parse(readFileSync(DUMP_PATH, "utf8")) as Dump;
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * 덤프는 P2 외부리뷰 **증거물**이라 P3 작업 중 바뀐 description 을 아직 반영하지 않았다(2026-09-09 실측 드리프트).
 * 스키마·이름·instructions 는 완전 일치하므로 여기서는 "라이브와 같거나, 아래 P2 시점 해시와 같음" 만 허용한다.
 * → 덤프를 재생성하면 그대로 통과하고(라이브와 일치), **그 밖의 새 드리프트는 실패**한다. 해시를 늘리지 말고 재생성할 것.
 */
// 덤프 재생성 완료(2026-09-09) → description 은 하드 동등 비교(허용 목록 없음)

const ajv = new Ajv({ strict: true, allErrors: true });
const compiled = new Map<string, ValidateFunction>();
function validator(key: string): ValidateFunction {
  const v = compiled.get(key);
  if (!v) throw new Error(`validator not compiled: ${key}`);
  return v;
}
/** ajv 오류를 `validateSubset` 과 비교 가능한 문자열 목록으로. */
function ajvErrors(v: ValidateFunction, value: unknown): string[] {
  return v(value) ? [] : (v.errors ?? []).map((e) => `${e.instancePath || "$"}: ${e.message ?? "invalid"}`);
}

beforeAll(() => {
  for (const t of TOOLS) {
    compiled.set(`${t.name}:in`, ajv.compile(t.inputSchema));
    compiled.set(`${t.name}:out`, ajv.compile(t.outputSchema));
  }
});

// ---------------------------------------------------------------------------
// 1. 커밋된 tools/list 덤프 ↔ 라이브 TOOLS
// ---------------------------------------------------------------------------
describe("P3-27+ 커밋된 P2-tools-list.json 이 라이브 TOOLS 와 일치", () => {
  it("도구 이름 집합이 같다", () => {
    expect(dump.tools.map((t) => t.name).sort(), `P2-tools-list.json is out of date — ${REGEN}`).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("instructions 가 같다", () => {
    expect(dump.instructions, `P2-tools-list.json instructions drifted — ${REGEN}`).toBe(SERVER_INSTRUCTIONS);
  });

  for (const live of TOOLS) {
    it(`${live.name} — inputSchema·outputSchema 가 완전히 같다`, () => {
      const d = dump.tools.find((t) => t.name === live.name);
      expect(d, `${live.name} missing from the dump — ${REGEN}`).toBeDefined();
      expect(d?.inputSchema, `${live.name}.inputSchema drifted — ${REGEN}`).toEqual(live.inputSchema);
      expect(d?.outputSchema, `${live.name}.outputSchema drifted — ${REGEN}`).toEqual(live.outputSchema);
    });

    it(`${live.name} — description 이 라이브와 바이트 동일하다`, () => {
      const d = dump.tools.find((t) => t.name === live.name) as DumpTool;
      expect(sha(d.description), `${live.name}.description drifted — ${REGEN}`).toBe(sha(live.description));
    });
  }

  it("덤프 항목은 name·description·inputSchema·outputSchema 4개 키만 담는다", () => {
    for (const t of dump.tools) expect(Object.keys(t).sort()).toEqual(["description", "inputSchema", "outputSchema", "name"].sort());
  });
});

// ---------------------------------------------------------------------------
// 2. 스키마 자체를 ajv 로 컴파일 (strict)
// ---------------------------------------------------------------------------
describe("P3-27+ ajv strict 컴파일", () => {
  for (const t of TOOLS) {
    it(`${t.name} — inputSchema·outputSchema 가 ajv strict 로 컴파일된다`, () => {
      expect(() => ajv.compile(t.inputSchema)).not.toThrow();
      expect(() => ajv.compile(t.outputSchema)).not.toThrow();
    });
  }

  it("덤프에 실린 스키마도 그대로 컴파일된다(증거물 자체 검증)", () => {
    for (const t of dump.tools) {
      expect(() => ajv.compile(t.inputSchema), `${t.name}.inputSchema`).not.toThrow();
      expect(() => ajv.compile(t.outputSchema), `${t.name}.outputSchema`).not.toThrow();
    }
  });

  it("ajv strict 는 실제로 이빨이 있다 — 잘못된 스키마는 컴파일 실패", () => {
    expect(() => ajv.compile({ type: "object", properties: { a: { type: "string" } }, bogusKeyword: 1 })).toThrow();
    expect(() => ajv.compile({ type: "nosuchtype" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. 실제 응답을 ajv 컴파일 검증기로 검사
// ---------------------------------------------------------------------------
interface Sample {
  name: string;
  args: Record<string, unknown>;
}
const SAMPLES: Sample[] = [
  { name: "wiki_expand", args: { terms: ["rerank"], max: 15, top_seed: 6, rerank: 11 } },
  { name: "wiki_pack", args: { slugs: ["concept-reranking", "fact-latency-budget-old", "entity-northwind-team", "nonexistent-slug"] } },
  { name: "wiki_read_page", args: { slug: "fact-latency-budget-old" } },
  { name: "wiki_search", args: { terms: ["벡터", "인덱스"], top: 8 } },
];

describe("P3-27+ 픽스처 볼트 실응답 ↔ ajv", () => {
  for (const s of SAMPLES) {
    it(`${s.name} — 유효한 인자의 structuredContent 가 ajv outputSchema 를 통과`, async () => {
      expect(ajvErrors(validator(`${s.name}:in`), s.args), `${s.name} sample args must satisfy inputSchema`).toEqual([]);
      const r = await callTool(FIXTURE_VAULT, s.name, s.args, undefined, true);
      expect(r.isError, `${s.name} returned isError`).toBeFalsy();
      expect(r.structuredContent).toBeDefined();
      const sc = r.structuredContent as Record<string, unknown>;
      expect(ajvErrors(validator(`${s.name}:out`), sc)).toEqual([]);
      // 손수 만든 검증기도 같은 값에 대해 통과해야 한다(양성 방향 교차 검증)
      expect(validateSubset((TOOLS.find((t) => t.name === s.name) as (typeof TOOLS)[number]).outputSchema, sc)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. 일부러 틀린 객체 — ajv 와 validateSubset 의 판정이 일치하는가
// ---------------------------------------------------------------------------
const GOOD_EXPAND_ROW = { tier: "seed", refs: 2, slug: "a", type: "concept" };
const GOOD_PACK_PAGE = { slug: "a", found: true, type: "concept", confidence: "0.9", status: "active", claims: ["c"], summary: "s", relations: ["r"] };
const GOOD_FRONTMATTER = { type: "concept", confidence: "0.9", status: "active" };

const BAD: { tool: string; why: string; value: unknown }[] = [
  { tool: "wiki_expand", why: "suggested_next 가 enum 밖", value: { text: "t", rows: [GOOD_EXPAND_ROW], suggested_next: "nope", truncated: false } },
  { tool: "wiki_expand", why: "truncated 누락", value: { text: "t", rows: [GOOD_EXPAND_ROW], suggested_next: "answer" } },
  { tool: "wiki_expand", why: "rows[].tier 가 enum 밖", value: { text: "t", rows: [{ ...GOOD_EXPAND_ROW, tier: "bogus" }], suggested_next: "answer", truncated: false } },
  { tool: "wiki_expand", why: "rows[].slug 가 문자열이 아님", value: { text: "t", rows: [{ ...GOOD_EXPAND_ROW, slug: 1 }], suggested_next: "answer", truncated: false } },
  { tool: "wiki_pack", why: "pages 누락", value: { text: "t", truncated: false } },
  { tool: "wiki_pack", why: "pages[].claims 누락", value: { text: "t", pages: [{ ...GOOD_PACK_PAGE, claims: undefined }], truncated: false } },
  { tool: "wiki_pack", why: "pages[].claims 가 문자열 배열이 아님", value: { text: "t", pages: [{ ...GOOD_PACK_PAGE, claims: [1] }], truncated: false } },
  { tool: "wiki_pack", why: "truncated 가 문자열", value: { text: "t", pages: [GOOD_PACK_PAGE], truncated: "false" } },
  { tool: "wiki_read_page", why: "path 누락", value: { slug: "a", resolved_from_alias: false, frontmatter: GOOD_FRONTMATTER, text: "t", truncated: false } },
  { tool: "wiki_read_page", why: "frontmatter.status 누락", value: { slug: "a", resolved_from_alias: false, path: "wiki/a.md", frontmatter: { type: "c", confidence: "0.9" }, text: "t", truncated: false } },
  { tool: "wiki_read_page", why: "frontmatter 가 객체가 아님", value: { slug: "a", resolved_from_alias: false, path: "wiki/a.md", frontmatter: "none", text: "t", truncated: false } },
  { tool: "wiki_search", why: "matched 가 정수가 아님", value: { text: "t", rows: [], matched: 1.5, truncated: false } },
  { tool: "wiki_search", why: "rows[].distinct 가 문자열", value: { text: "t", rows: [{ distinct: "1", total: 2, slug: "a", type: "c" }], matched: 1, truncated: false } },
  { tool: "wiki_search", why: "rows 가 배열이 아님", value: { text: "t", rows: {}, matched: 0, truncated: false } },
];

describe("P3-27+ 교차 검증 — 틀린 객체는 ajv 와 validateSubset 이 함께 거부한다", () => {
  for (const b of BAD) {
    it(`${b.tool} — ${b.why}`, () => {
      const schema = (TOOLS.find((t) => t.name === b.tool) as (typeof TOOLS)[number]).outputSchema;
      const fromAjv = ajvErrors(validator(`${b.tool}:out`), b.value);
      const fromOurs = validateSubset(schema, b.value);
      expect(fromAjv.length, `ajv accepted an invalid value: ${JSON.stringify(b.value).slice(0, 160)}`).toBeGreaterThan(0);
      expect(fromOurs.length, `validateSubset accepted an invalid value: ${JSON.stringify(b.value).slice(0, 160)}`).toBeGreaterThan(0);
    });
  }

  it("유효한 인자는 두 검증기 모두 inputSchema 를 통과시킨다", () => {
    for (const s of SAMPLES) {
      const schema = (TOOLS.find((t) => t.name === s.name) as (typeof TOOLS)[number]).inputSchema;
      expect(ajvErrors(validator(`${s.name}:in`), s.args), s.name).toEqual([]);
      expect(validateSubset(schema, s.args), s.name).toEqual([]);
    }
  });

  it("잘못된 **입력**도 두 검증기가 함께 거부한다", () => {
    const cases: { tool: string; value: unknown }[] = [
      { tool: "wiki_expand", value: { terms: [] } }, // minItems 1
      { tool: "wiki_expand", value: { terms: ["a"], max: 999 } }, // maximum 50
      { tool: "wiki_expand", value: { terms: ["a"], rerank: 1.5 } }, // integer
      { tool: "wiki_pack", value: { slugs: ["ok", ""] } }, // minLength 1
      { tool: "wiki_read_page", value: {} }, // required slug
      { tool: "wiki_search", value: { terms: ["a"], top: 0 } }, // minimum 1
    ];
    for (const c of cases) {
      const schema = (TOOLS.find((t) => t.name === c.tool) as (typeof TOOLS)[number]).inputSchema;
      expect(ajvErrors(validator(`${c.tool}:in`), c.value).length, `ajv: ${c.tool} ${JSON.stringify(c.value)}`).toBeGreaterThan(0);
      expect(validateSubset(schema, c.value).length, `validateSubset: ${c.tool} ${JSON.stringify(c.value)}`).toBeGreaterThan(0);
    }
  });

  it("알려진 비대칭 — 미선언 속성은 validateSubset 만 거부한다(스키마에 additionalProperties 를 싣지 않으므로)", () => {
    const extra = { text: "t", rows: [], suggested_next: "answer", truncated: false, surprise: 1 };
    const schema = (TOOLS.find((t) => t.name === "wiki_expand") as (typeof TOOLS)[number]).outputSchema;
    expect(ajvErrors(validator("wiki_expand:out"), extra)).toEqual([]); // ajv: 허용(호환성 위해 스키마는 개방형)
    expect(validateSubset(schema, extra)).toEqual(["$.surprise: unexpected property"]); // 내부는 fail-closed
  });
});

// ---------------------------------------------------------------------------
// 5. 금지 키워드 (다중 클라이언트 호환, DESIGN §3)
// ---------------------------------------------------------------------------
const FORBIDDEN = ["anyOf", "oneOf", "allOf", "$ref", "$defs", "const", "default", "additionalProperties", "format", "$schema", "execution"];

function forbiddenKeys(node: unknown, at = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => forbiddenKeys(v, `${at}[${i}]`));
  if (typeof node !== "object" || node === null) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (FORBIDDEN.includes(k)) out.push(`${at}.${k}`);
    // description 안의 자연어는 검사 대상이 아니다 — **키**만 본다(기존 정규식 검사보다 엄밀).
    if (k !== "description") out.push(...forbiddenKeys(v, `${at}.${k}`));
  }
  return out;
}

describe("P3-27+ 금지 키워드 부재", () => {
  for (const t of TOOLS) {
    it(`${t.name} — input·output 스키마에 금지 키워드 없음`, () => {
      expect(forbiddenKeys(t.inputSchema, `${t.name}.inputSchema`)).toEqual([]);
      expect(forbiddenKeys(t.outputSchema, `${t.name}.outputSchema`)).toEqual([]);
    });
  }

  it("커밋된 덤프에도 금지 키워드가 없다", () => {
    for (const t of dump.tools) {
      expect(forbiddenKeys(t.inputSchema, `${t.name}.inputSchema`)).toEqual([]);
      expect(forbiddenKeys(t.outputSchema, `${t.name}.outputSchema`)).toEqual([]);
    }
  });

  it("검사기 자체 점검 — 금지 키워드가 있으면 잡는다", () => {
    expect(forbiddenKeys({ type: "object", properties: { a: { anyOf: [] } } })).toEqual(["$.properties.a.anyOf"]);
    expect(forbiddenKeys({ type: "object", description: "the default is anyOf" })).toEqual([]);
  });
});

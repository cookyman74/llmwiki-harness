/**
 * P2-12 스키마 부분집합 · P2-13 도구명 · P2-14 description/instructions (DESIGN §3 다중 클라이언트 호환 규칙).
 * tools/list 를 실제 클라이언트로 덤프해 검사한다 — 소스의 TOOLS 상수가 아니라 와이어에 나가는 형태가 기준.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { FIXTURE_VAULT, connect, type Connected } from "./p2-helpers.js";

const FORBIDDEN = /"(anyOf|oneOf|allOf|\$ref|\$defs|const|default|additionalProperties|format|\$schema|execution)"/;
const ALLOWED_KEYS = new Set(["type", "properties", "required", "items", "enum", "description", "minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"]);
const ALLOWED_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean"]);
const EXPECTED_NAMES = ["wiki_expand", "wiki_pack", "wiki_read_page", "wiki_search"] // P3 실측 반영: 진입점 먼저, fallback(wiki_search) 마지막 — 클라이언트가 목록 앞을 먼저 고르는 경향;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** 스키마 트리를 걸으며 (경로, 키, 값) 을 방문. properties 의 키(프로퍼티 이름)는 스키마 키워드가 아니므로 제외. */
function walkSchema(node: unknown, at: string, visit: (at: string, key: string, value: unknown) => void): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) throw new Error(`${at}: schema node must be an object`);
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    visit(at, k, v);
    if (k === "properties") {
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) walkSchema(pv, `${at}.properties.${pk}`, visit);
    } else if (k === "items") {
      walkSchema(v, `${at}.items`, visit);
    }
  }
}

let c: Connected;
let tools: Tool[];
beforeAll(async () => {
  c = await connect(FIXTURE_VAULT, { structured: true });
  tools = (await c.client.listTools()).tools;
});
afterAll(async () => c.close());

describe("P2-12 schema subset", () => {
  it("P2-12 tools/list 덤프에 금지 키워드 0건", () => {
    const dump = JSON.stringify(tools);
    expect(dump.length).toBeGreaterThan(0);
    expect(dump.match(FORBIDDEN)).toBeNull();
  });

  it("P2-12 모든 스키마 노드의 키·type 이 허용 부분집합 안에 있다", () => {
    const violations: string[] = [];
    for (const t of tools) {
      for (const which of ["inputSchema", "outputSchema"] as const) {
        const schema = t[which];
        expect(schema, `${t.name}.${which}`).toBeDefined();
        walkSchema(schema, `${t.name}.${which}`, (at, key, value) => {
          if (!ALLOWED_KEYS.has(key)) violations.push(`${at}: key "${key}"`);
          if (key === "type" && !(typeof value === "string" && ALLOWED_TYPES.has(value))) violations.push(`${at}: type ${JSON.stringify(value)}`);
        });
      }
    }
    expect(violations).toEqual([]);
  });

  it("P2-12 각 도구는 최상위 type: object + required 배열을 가진 inputSchema 를 선언한다", () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
      expect((t.inputSchema.required as string[]).length).toBeGreaterThan(0);
    }
  });
});

describe("P2-13 tool names", () => {
  it("P2-13 도구명 ^[a-z][a-z0-9_]{0,63}$ + 정확히 4개", () => {
    const names = tools.map((t) => t.name);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(names).toEqual(EXPECTED_NAMES);
  });
});

describe("P2-14 descriptions / instructions", () => {
  it("P2-14 description 각 ≤500자, 합계 ≤2000자", () => {
    let sum = 0;
    for (const t of tools) {
      const d = t.description ?? "";
      expect(d.length, `${t.name} description length ${d.length}`).toBeLessThanOrEqual(500);
      sum += d.length;
    }
    expect(sum).toBeLessThanOrEqual(2000);
  });

  it("P2-14 description = 영문 첫 줄 + 한국어 줄 + 마지막 줄 Routing:", () => {
    for (const t of tools) {
      const lines = (t.description ?? "").split("\n");
      expect(lines.length, t.name).toBeGreaterThanOrEqual(3);
      expect(lines[0], `${t.name} first line must be English`).toMatch(/[A-Za-z]/);
      expect(lines[0], `${t.name} first line must not contain Hangul`).not.toMatch(HANGUL);
      expect(lines.some((ln) => HANGUL.test(ln)), `${t.name} needs a Korean line`).toBe(true);
      expect(lines[lines.length - 1].startsWith("Routing:"), `${t.name} last line must be the routing line`).toBe(true);
      for (const ln of lines) expect(ln.trim().length, `${t.name} has an empty description line`).toBeGreaterThan(0);
    }
  });

  it("P2-14 instructions 3줄 — read-only · 라우팅 · stale/superseded_by", () => {
    const ins = c.client.getInstructions();
    expect(typeof ins).toBe("string");
    const lines = (ins as string).split("\n");
    expect(lines).toHaveLength(3);
    expect(ins).toContain("read-only");
    expect(lines[1].startsWith("Routing:")).toBe(true);
    expect(ins).toContain("stale");
    expect(ins).toContain("superseded_by");
  });
});

/**
 * P2-33 — `--once` 와 MCP 도구 텍스트 동일성 (같은 코드 경로 증명). queries.json × 4모드(gen-expected.py 의 commands 와 동일한
 * 인자)를 runOnce 와 callTool 양쪽으로 실행해 content[0].text 를 runOnce 문자열과 대조한다. rerank 도 두 경로가 같은 프로세스·
 * 같은 함수이므로 여기서는 바이트 동일(골든의 ±0.05 허용오차는 Python 대비 규칙).
 *
 * 3차 리뷰(codex MAJOR-5) 이후 **wiki_expand 만 예외**: MCP 응답 텍스트 끝에 `suggested_next: …` 한 줄이 더 붙는다
 * (structuredContent 를 못 읽는 클라이언트도 다음 도구를 알 수 있게). `--once` 출력은 그대로 — Python 패리티 대상이므로
 * 바이트가 바뀌면 안 된다. 따라서 expand/rerank 는 `mcp === once + "suggested_next: <값>\n"`, search/pack 은 완전 동일.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOnce } from "../../src/once.js";
import { suggestedNext } from "../../src/tools.js";
import { FIXTURES, FIXTURE_VAULT, connect, text, type Connected } from "./p2-helpers.js";

interface Query {
  id: string;
  terms: string[];
  case: string;
  pack_slugs: string[];
}
interface Spec {
  defaults: { search_top: number; expand_max: number; expand_top_seed: number; rerank_max: number; rerank_n: number };
  queries: Query[];
}
const spec = JSON.parse(readFileSync(path.join(FIXTURES, "queries.json"), "utf8")) as Spec;
const d = spec.defaults;
const V = FIXTURE_VAULT;

let c: Connected;
beforeAll(async () => {
  c = await connect(V, { structured: true });
});
afterAll(async () => c.close());

describe("P2-33 --once vs MCP text equality", () => {
  expect(spec.queries.length).toBeGreaterThan(0);
  for (const q of spec.queries) {
    it(`P2-33 ${q.id}-search — ${q.case}`, async () => {
      const once = await runOnce("search", ["--files", ...q.terms, "--root", V, "--top", String(d.search_top)]);
      const r = await c.call("wiki_search", { terms: q.terms, top: d.search_top });
      expect(r.isError, text(r)).toBeFalsy();
      expect(text(r)).toBe(once);
    });
    it(`P2-33 ${q.id}-expand — ${q.case}`, async () => {
      const once = await runOnce("expand", [...q.terms, "--root", V, "--top-seed", String(d.expand_top_seed), "--max", String(d.expand_max)]);
      const r = await c.call("wiki_expand", { terms: q.terms, top_seed: d.expand_top_seed, max: d.expand_max });
      expect(r.isError, text(r)).toBeFalsy();
      const sc = r.structuredContent as Record<string, unknown>;
      expect(sc.suggested_next).toBe(suggestedNext(d.expand_max, 0));
      expect(text(r)).toBe(`${once}suggested_next: ${sc.suggested_next as string}\n`); // 힌트 1줄만 차이
      expect(text(r)).toBe(sc.text);
    });
    it(`P2-33 ${q.id}-rerank — ${q.case}`, async () => {
      const once = await runOnce("expand", [...q.terms, "--root", V, "--top-seed", String(d.expand_top_seed), "--max", String(d.rerank_max), "--rerank", String(d.rerank_n)]);
      const r = await c.call("wiki_expand", { terms: q.terms, top_seed: d.expand_top_seed, max: d.rerank_max, rerank: d.rerank_n });
      expect(r.isError, text(r)).toBeFalsy();
      const sc = r.structuredContent as Record<string, unknown>;
      expect(sc.suggested_next).toBe(suggestedNext(d.rerank_max, d.rerank_n));
      expect(text(r)).toBe(`${once}suggested_next: ${sc.suggested_next as string}\n`);
      expect(text(r)).toBe(sc.text);
    });
    it(`P2-33 ${q.id}-pack — ${q.case}`, async () => {
      const once = await runOnce("pack", [...q.pack_slugs, "--root", V]);
      const r = await c.call("wiki_pack", { slugs: q.pack_slugs });
      expect(r.isError, `wiki_pack rejected slugs ${JSON.stringify(q.pack_slugs)} that --once pack accepts: ${text(r)}`).toBeFalsy();
      expect(text(r)).toBe(once);
    });
  }
});

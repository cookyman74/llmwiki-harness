/**
 * P4-27+ — 구조화 출력 기본 off(텍스트만), `LLMWIKI_STRUCTURED=1` 로 opt-in.
 *
 * 근거(2026-09-10 Claude Code E2E): Claude Code 는 structuredContent 가 있으면 그 JSON 을 모델에 넘기는데, 우리
 * structuredContent 는 `text` 와 `rows`/`pages` 가 같은 정보를 이중으로 담아 모델 입력이 텍스트 대비 2.06~4.24배였다.
 *
 * 여기서 고정하는 것:
 *  ① 기본 서버는 tools/list 에 outputSchema 를 선언하지 않고, 응답에 structuredContent 를 싣지 않는다
 *     (MCP 스펙: outputSchema 선언 = structuredContent 전송 의무 → 둘은 함께 켜지고 꺼져야 한다)
 *  ② 텍스트는 opt-in 모드와 **바이트 동일** — 기본을 바꿔도 모델이 받는 내용(텍스트 표현)은 달라지지 않는다
 *  ③ 기본 모드의 와이어 크기가 opt-in 보다 작다(이 변경의 목적)
 *  ④ 실제 CLI 서버의 env 배선: 미지정 → 텍스트만, `LLMWIKI_STRUCTURED=1` → outputSchema + structuredContent
 */
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { DIST_CLI, FIXTURE_VAULT, connect, text, type ToolResult } from "./p2-helpers.js";

const CALLS: [string, Record<string, unknown>][] = [
  // 픽스처 볼트에 실재하는 질의·slug(test/fixtures/queries.json q3 과 같은 term)
  ["wiki_search", { terms: ["chunking", "청킹"] }],
  ["wiki_expand", { terms: ["chunking", "청킹"], rerank: 11 }],
  ["wiki_expand", { terms: ["chunking", "청킹"], max: 8 }],
  ["wiki_pack", { slugs: ["concept-chunking", "concept-reranking"] }],
  ["wiki_read_page", { slug: "concept-chunking" }],
];

async function runAll(structured: boolean): Promise<{ tools: Record<string, unknown>[]; results: ToolResult[] }> {
  const c = await connect(FIXTURE_VAULT, { structured });
  try {
    const tools = (await c.client.listTools()).tools as unknown as Record<string, unknown>[];
    const results: ToolResult[] = [];
    for (const [name, args] of CALLS) results.push(await c.call(name, args));
    return { tools, results };
  } finally {
    await c.close();
  }
}

describe("P4-27+ 구조화 출력 기본 off", () => {
  it("① 기본 서버: outputSchema 미선언 · structuredContent 없음 · 오류 없음", async () => {
    const { tools, results } = await runAll(false);
    expect(tools).toHaveLength(4);
    for (const t of tools) expect(t).not.toHaveProperty("outputSchema");
    for (const r of results) {
      expect(r.isError ?? false).toBe(false);
      expect(r).not.toHaveProperty("structuredContent");
      expect(r.content).toHaveLength(1);
      expect(text(r).length).toBeGreaterThan(0);
    }
  });

  it("② 텍스트는 opt-in 모드와 바이트 동일(suggested_next 줄 포함)", async () => {
    const [off, on] = await Promise.all([runAll(false), runAll(true)]);
    off.results.forEach((r, i) => expect(text(r)).toBe(text(on.results[i])));
    expect(text(off.results[1])).toMatch(/suggested_next: /); // 라우팅 힌트는 텍스트에 그대로 남는다
    for (const t of on.tools) expect(t).toHaveProperty("outputSchema"); // opt-in 은 기존 계약 그대로
    for (const r of on.results) expect(r).toHaveProperty("structuredContent");
  });

  it("③ 기본 모드의 응답 크기가 opt-in 보다 작다(모델이 받는 양 — 이 변경의 목적)", async () => {
    const [off, on] = await Promise.all([runAll(false), runAll(true)]);
    const size = (r: ToolResult): number => Buffer.byteLength(JSON.stringify(r), "utf8");
    off.results.forEach((r, i) => expect(size(r)).toBeLessThan(size(on.results[i])));
  });
});

describe.skipIf(!existsSync(DIST_CLI))("P4-27+ CLI env 배선(실제 stdio 서버)", () => {
  async function listAndCall(structuredEnv?: string): Promise<{ hasSchema: boolean; hasStructured: boolean; text: string }> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "LLMWIKI_STRUCTURED" && k !== "LLMWIKI_DEBUG") env[k] = v;
    if (structuredEnv !== undefined) env.LLMWIKI_STRUCTURED = structuredEnv;
    const transport = new StdioClientTransport({ command: process.execPath, args: [DIST_CLI, "--root", FIXTURE_VAULT], env, stderr: "ignore" });
    const client = new Client({ name: "p4-27", version: "0" });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools as unknown as Record<string, unknown>[];
      const r = (await client.callTool({ name: "wiki_expand", arguments: { terms: ["chunking", "청킹"], max: 8 } })) as unknown as ToolResult;
      return { hasSchema: tools.every((t) => "outputSchema" in t), hasStructured: "structuredContent" in r, text: text(r) };
    } finally {
      await client.close();
    }
  }

  it("④ 미지정 → 텍스트만, LLMWIKI_STRUCTURED=1 → outputSchema + structuredContent, 텍스트는 동일", async () => {
    const def = await listAndCall();
    const on = await listAndCall("1");
    const other = await listAndCall("true"); // '1' 외의 값은 켜지 않는다
    expect(def).toMatchObject({ hasSchema: false, hasStructured: false });
    expect(on).toMatchObject({ hasSchema: true, hasStructured: true });
    expect(other).toMatchObject({ hasSchema: false, hasStructured: false });
    expect(on.text).toBe(def.text);
  });
});

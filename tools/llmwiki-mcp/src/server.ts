/**
 * server.ts — MCP stdio 서버 (DESIGN §3, §3.5; P2-01~P2-10).
 *
 * 저수준 `Server` + 수기 JSON Schema(tools.ts)를 쓴다 — `McpServer`+zod 는 tools/list 에 `$schema`·
 * `additionalProperties`·`execution` 을 자동 삽입해 다중 클라이언트 호환 규칙(§3)을 어기기 때문(2026-09-09 실측).
 * 도구 핸들러는 `--once` 와 **같은 함수**(once.ts)를 호출한다(P2-33).
 * stdout 은 transport 전용. 진단은 stderr, 기본 quiet, `LLMWIKI_DEBUG=1` 이면 도구별 소요(ms)만(질의어·내용 금지).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { expandData, packData, searchData } from "./once.js";
import { PageNotFound, readPage } from "./read.js";
import { LIMITS, RESPONSE_LIMIT, SERVER_INSTRUCTIONS, TOOLS, ToolInputError, capPages, capText, normalizeInt, normalizeSlug, normalizeSlugs, normalizeTerms, suggestedNext, validateSubset } from "./tools.js";
import { VaultLimitError } from "./vault.js";

export interface ServerOptions {
  root: string; // realpath 정규화된 볼트 루트
  version: string;
  debug?: boolean;
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const debugLog = (enabled: boolean | undefined, msg: string): void => {
  if (enabled) process.stderr.write(`[llmwiki] ${msg}\n`);
};

/** 동시 도구 호출 상한(리뷰 MAJOR: 요청 자체에 동시성 제한 없음). 초과분은 큐에서 순서대로 대기. */
export const MAX_CONCURRENT_CALLS = 4;
let inFlight = 0;
const waiters: (() => void)[] = [];
// 슬롯 인계 패턴(agy 2차 MAJOR-2): 대기자가 있으면 inFlight 를 줄이지 않고 슬롯을 직접 넘긴다 → 큐 추월·초과 진입 불가
async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_CALLS) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function release(): void {
  const next = waiters.shift();
  if (next) next();
  else inFlight--;
}
/** 테스트용 관측치 */
export function concurrencyState(): { inFlight: number; waiting: number } {
  return { inFlight, waiting: waiters.length };
}

/** 응답 직전 outputSchema 검증 — 저수준 Server 는 검증하지 않으므로 fail-closed(리뷰 MAJOR: 거짓 계약 방지). */
function checkOutput(name: string, sc: Record<string, unknown>): void {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return;
  const errs = validateSubset(def.outputSchema, sc);
  if (errs.length) throw new Error(`internal: ${name} output does not match outputSchema: ${errs.slice(0, 3).join("; ")}`);
}

/** 도구 1건 실행 — 서버·테스트가 공유. 입력 정규화 → P1 함수 → 텍스트 + structuredContent. */
export async function callTool(root: string, name: string, args: Record<string, unknown> | undefined, debug?: boolean): Promise<ToolResult> {
  await acquire();
  try {
    return await callToolInner(root, name, args, debug);
  } finally {
    release();
  }
}

async function callToolInner(root: string, name: string, args: Record<string, unknown> | undefined, debug?: boolean): Promise<ToolResult> {
  const a = args ?? {};
  const t0 = Date.now();
  try {
    let result: ToolResult;
    switch (name) {
      case "wiki_search": {
        const terms = normalizeTerms(a.terms);
        const top = normalizeInt(a.top, "top", LIMITS.topMin, LIMITS.topMax, LIMITS.topDefault);
        const d = await searchData(terms, root, top);
        const { text, truncated } = capText(d.text);
        result = { content: [{ type: "text", text }], structuredContent: { text, rows: d.rows, matched: d.matched, truncated } };
        break;
      }
      case "wiki_expand": {
        const terms = normalizeTerms(a.terms);
        const max = normalizeInt(a.max, "max", LIMITS.maxMin, LIMITS.maxMax, LIMITS.maxDefault);
        const topSeed = normalizeInt(a.top_seed, "top_seed", LIMITS.topSeedMin, LIMITS.topSeedMax, LIMITS.topSeedDefault);
        const rerank = normalizeInt(a.rerank, "rerank", LIMITS.rerankMin, LIMITS.rerankMax, LIMITS.rerankDefault);
        const d = await expandData(terms, { root, topSeed, max, rerank });
        const next = suggestedNext(max, rerank);
        // 라우팅 힌트를 **텍스트에도** 넣는다 — structuredContent 미지원 클라이언트에서 다음 도구를 알 수 없던 결함(codex 3차 MAJOR-5).
        // Python 패리티 대상은 `--once`(순수 리트리벌 텍스트)이고 MCP 응답은 이 한 줄을 덧붙인다.
        const withHint = `${d.text}suggested_next: ${next}\n`;
        const { text, truncated } = capText(withHint);
        result = { content: [{ type: "text", text }], structuredContent: { text, rows: d.rows, suggested_next: next, truncated } };
        break;
      }
      case "wiki_pack": {
        const slugs = normalizeSlugs(a.slugs);
        const d = await packData(slugs, root);
        const { text, truncated } = capText(d.text);
        const capped = capPages(d.pages); // structuredContent 도 같은 예산(리뷰 BLOCKER: text 만 자르면 우회)
        result = { content: [{ type: "text", text }], structuredContent: { text, pages: capped.pages, truncated: truncated || capped.truncated } };
        break;
      }
      case "wiki_read_page": {
        const slug = normalizeSlug(a.slug);
        const r = await readPage(root, slug);
        result = { content: [{ type: "text", text: r.text }], structuredContent: { ...r } };
        break;
      }
      default:
        return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
    }
    if (result.structuredContent) {
      // 응답 전체(JSON envelope) 예산 — text·pages 를 각각 잘라도 합이 200KB 를 넘던 문제(codex 3차 MAJOR-4)
      let sc = result.structuredContent;
      if (Buffer.byteLength(JSON.stringify(sc), "utf8") > RESPONSE_LIMIT) {
        // 텍스트를 절반→8분의1→…로 줄이며 **다시 측정**한다(3차 테스트 검토: 한 번만 줄이면 다른 큰 필드가 남아 초과 유지)
        let budget = Math.floor(RESPONSE_LIMIT / 2);
        let text = result.content[0].text;
        for (let i = 0; i < 6; i++) {
          const t = capText(text, budget);
          const shrunk: Record<string, unknown> = { ...sc, text: t.text, truncated: true };
          if (name === "wiki_pack") shrunk.pages = [];
          sc = shrunk;
          text = t.text;
          if (Buffer.byteLength(JSON.stringify(sc), "utf8") <= RESPONSE_LIMIT) break;
          budget = Math.floor(budget / 4);
        }
        if (Buffer.byteLength(JSON.stringify(sc), "utf8") > RESPONSE_LIMIT) {
          return { content: [{ type: "text", text: `response exceeds ${RESPONSE_LIMIT} bytes even after truncation` }], isError: true };
        }
        result = { content: [{ type: "text", text }], structuredContent: sc };
      }
      checkOutput(name, sc);
    }
    debugLog(debug, `${name} ${Date.now() - t0}ms`);
    return result;
  } catch (e) {
    debugLog(debug, `${name} error ${Date.now() - t0}ms`);
    if (e instanceof ToolInputError || e instanceof PageNotFound || e instanceof VaultLimitError) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
    throw e;
  }
}

export function createServer(opts: ServerOptions): Server {
  const server = new Server({ name: "llmwiki", version: opts.version }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(opts.root, req.params.name, req.params.arguments as Record<string, unknown> | undefined, opts.debug));
  return server;
}

export async function startStdio(opts: ServerOptions): Promise<void> {
  const server = createServer(opts);
  await server.connect(new StdioServerTransport());
  debugLog(opts.debug, "ready"); // root 경로는 로그에 남기지 않는다(리뷰)
}

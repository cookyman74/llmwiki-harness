/**
 * server.ts — MCP stdio 서버 (DESIGN §3, §3.5; P2-01~P2-10).
 *
 * 저수준 `Server` + 수기 JSON Schema(tools.ts)를 쓴다 — `McpServer`+zod 는 tools/list 에 `$schema`·
 * `additionalProperties`·`execution` 을 자동 삽입해 다중 클라이언트 호환 규칙(§3)을 어기기 때문(2026-09-09 실측).
 * 도구 핸들러는 `--once` 와 **같은 함수**(once.ts)를 호출한다(P2-33).
 * stdout 은 transport 전용. 진단은 stderr, 기본 quiet, `LLMWIKI_DEBUG=1` 이면 도구별 소요(ms)만(질의어·내용 금지).
 *
 * **구조화 출력은 기본 off (P4-27+, 2026-09-10 E2E 근거)**: Claude Code 2.1.267 은 `structuredContent` 가 있으면 그 JSON 을
 * 모델에 넘기는데, 우리 structuredContent 는 `text` 와 `rows`/`pages` 가 같은 정보를 이중으로 담아 모델 입력이 텍스트
 * 대비 2.06~4.24배였다(pack 9,715B → 20,015B). 이 서버의 소비자는 LLM 이고 텍스트(TSV)가 가장 작으므로 기본은 텍스트만
 * 보낸다. `LLMWIKI_STRUCTURED=1`(→ `ServerOptions.structured`)이면 `tools/list` 에 outputSchema 를 선언하고 응답에
 * structuredContent 를 싣는다 — MCP 스펙상 outputSchema 를 선언하면 structuredContent 가 필수이므로 둘은 항상 함께 켜진다.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { asStructuredContent, type ExpandStructured, type PackStructured, type ReadPageStructured, type SearchStructured } from "./contracts.js";
import { expandData, packData, searchData } from "./once.js";
import { PageNotFound, readPage } from "./read.js";
import { LIMITS, RESPONSE_LIMIT, SERVER_INSTRUCTIONS, TOOLS, ToolInputError, capPages, capText, normalizeInt, normalizeSlug, normalizeSlugs, normalizeTerms, suggestedNext, validateSubset } from "./tools.js";
import { VaultLimitError } from "./vault.js";

export interface ServerOptions {
  root: string; // realpath 정규화된 볼트 루트
  version: string;
  debug?: boolean;
  /** true 면 outputSchema 선언 + structuredContent 전송(opt-in). 기본 false — 텍스트만(P4-27+). */
  structured?: boolean;
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

/** 도구 1건 실행 — 서버·테스트가 공유. 입력 정규화 → P1 함수 → 텍스트 (+ `structured` 면 structuredContent).
 *  두 모드 모두 **응답 JSON 전체**를 RESPONSE_LIMIT 안으로 맞춘다. 텍스트는 작은 응답에서는 두 모드가 바이트 동일하고,
 *  envelope 을 넘는 큰 응답에서만 opt-in 쪽이 더 줄어든다(structuredContent 에 text 가 한 번 더 실리므로 — 의도된 차이). */
export async function callTool(
  root: string,
  name: string,
  args: Record<string, unknown> | undefined,
  debug: boolean | undefined,
  structured: boolean, // 기본값 없음 — 서버 기본(false)과 어긋나는 암묵값을 두지 않는다(외부리뷰 P4-27 m1)
): Promise<ToolResult> {
  await acquire();
  try {
    return await callToolInner(root, name, args, debug, structured);
  } finally {
    release();
  }
}

async function callToolInner(root: string, name: string, args: Record<string, unknown> | undefined, debug: boolean | undefined, structured: boolean): Promise<ToolResult> {
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
        // 타입 고정(P3-28+): outputSchema 대응 인터페이스로 만들어 필드 누락·오타를 tsc 가 잡게 한다.
        const sc: SearchStructured = { text, rows: d.rows, matched: d.matched, truncated };
        result = { content: [{ type: "text", text }], structuredContent: asStructuredContent(sc) };
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
        const sc: ExpandStructured = { text, rows: d.rows, suggested_next: next, truncated };
        result = { content: [{ type: "text", text }], structuredContent: asStructuredContent(sc) };
        break;
      }
      case "wiki_pack": {
        const slugs = normalizeSlugs(a.slugs);
        const d = await packData(slugs, root);
        const { text, truncated } = capText(d.text);
        const capped = capPages(d.pages); // structuredContent 도 같은 예산(리뷰 BLOCKER: text 만 자르면 우회)
        const sc: PackStructured = { text, pages: capped.pages, truncated: truncated || capped.truncated };
        result = { content: [{ type: "text", text }], structuredContent: asStructuredContent(sc) };
        break;
      }
      case "wiki_read_page": {
        const slug = normalizeSlug(a.slug);
        const r = await readPage(root, slug);
        const sc: ReadPageStructured = { ...r };
        result = { content: [{ type: "text", text: r.text }], structuredContent: asStructuredContent(sc) };
        break;
      }
      default:
        return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
    }
    if (!structured) {
      // 텍스트만 보낸다(P4-27+). capText 는 텍스트 바이트만 200KB 로 맞추므로, JSON 이스케이프(\n·\"·제어문자)로 부푼
      // **envelope 전체**가 RESPONSE_LIMIT 을 넘을 수 있다(외부리뷰 P4-27 codex·agy MAJOR) → 넘으면 opt-in 과 같은 방식으로
      // 텍스트를 줄이며 다시 잰다. 보내지 않을 pages 는 계산에 넣지 않는다.
      let text = result.content[0].text;
      const envelope = (t: string): number => Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: t }] }), "utf8");
      if (envelope(text) > RESPONSE_LIMIT) {
        let budget = Math.floor(RESPONSE_LIMIT / 2);
        for (let i = 0; i < 6 && envelope(text) > RESPONSE_LIMIT; i++) {
          text = capText(text, budget).text;
          budget = Math.floor(budget / 4);
        }
        if (envelope(text) > RESPONSE_LIMIT) {
          return { content: [{ type: "text", text: `response exceeds ${RESPONSE_LIMIT} bytes even after truncation` }], isError: true };
        }
      }
      debugLog(debug, `${name} ${Date.now() - t0}ms`);
      return { content: [{ type: "text", text }] };
    }
    if (result.structuredContent) {
      // 응답 전체(JSON envelope) 예산 — text·pages 를 각각 잘라도 합이 200KB 를 넘던 문제(codex 3차 MAJOR-4).
      // **실제로 전송되는 것 전체**(content[0].text + structuredContent)를 잰다. 예전에는 structuredContent 만 재서 text 가
      // 한 번 더 실리는 몫을 놓쳤다 — 이스케이프 많은 대형 read_page 에서 341,496B 로 상한을 넘은 것을 P4-27 테스트가 검출.
      const wire = (t: string, s: Record<string, unknown>): number =>
        Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: t }], structuredContent: s }), "utf8");
      let sc = result.structuredContent;
      if (wire(result.content[0].text, sc) > RESPONSE_LIMIT) {
        // 텍스트는 content 와 structuredContent 에 **두 번** 실린다. 텍스트를 뺀 나머지(행·pages·메타)를 먼저 재고, 남은 예산을
        // 둘로 나눈 값에서 시작해 ×0.75 씩 줄이며 다시 잰다 — 절반→1/8 로 뛰면 들어갈 수 있던 텍스트까지 버렸다(P4-27 측정 정정 후 검출).
        // pack 은 pages 가 텍스트와 같은 내용을 한 번 더 담으므로 초과 시 비운다(기존 규칙).
        let text = result.content[0].text;
        const base: Record<string, unknown> = { ...sc, text: "", truncated: true };
        if (name === "wiki_pack") base.pages = [];
        const baseWire = wire("", base);
        let budget = Math.max(0, Math.floor((RESPONSE_LIMIT - baseWire) / 2));
        for (let i = 0; i < 16; i++) {
          const t = capText(result.content[0].text, budget);
          sc = { ...base, text: t.text };
          text = t.text;
          const now = wire(text, sc);
          if (now <= RESPONSE_LIMIT) break;
          // 초과분에 비례해 한 번에 보정한다(JSON 이스케이프로 부푼 비율을 실측으로 반영) — 고정 비율로 줄이면 필요 이상 버린다.
          // 실측 비율로 한 번에 보정(여유 0.2%)하되 매 반복 최소 1바이트는 줄여 반드시 수렴한다 — 고정 캡(0.95)은 0.1% 초과에도 5% 를 버렸다.
          budget = Math.min(budget - 1, Math.floor(budget * ((RESPONSE_LIMIT - baseWire) / Math.max(1, now - baseWire)) * 0.998));
        }
        if (wire(text, sc) > RESPONSE_LIMIT) {
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
  const structured = opts.structured === true;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // outputSchema 는 structuredContent 를 실제로 보낼 때만 선언한다(선언 = 전송 의무).
    tools: TOOLS.map((t) =>
      structured
        ? { name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema }
        : { name: t.name, description: t.description, inputSchema: t.inputSchema },
    ),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(opts.root, req.params.name, req.params.arguments as Record<string, unknown> | undefined, opts.debug, structured),
  );
  return server;
}

export async function startStdio(opts: ServerOptions): Promise<void> {
  const server = createServer(opts);
  await server.connect(new StdioServerTransport());
  debugLog(opts.debug, "ready"); // root 경로는 로그에 남기지 않는다(리뷰)
}

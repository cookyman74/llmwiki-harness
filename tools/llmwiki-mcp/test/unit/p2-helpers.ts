/**
 * p2-helpers.ts — P2 테스트 공용: 인프로세스 MCP 클라이언트 연결 + 결과 캐스팅.
 * (vitest 는 *.test.ts 만 수집하므로 이 파일은 테스트로 실행되지 않는다.)
 *
 * 서버는 저수준 `Server` 이지만 클라이언트는 SDK `Client` 를 그대로 쓴다 — Client.callTool 은 tools/list 에서 캐시한
 * outputSchema 로 structuredContent 를 검증하므로(isError 결과는 제외), 이 경로를 타는 것만으로 §3 "스키마와 실제 JSON 일치"의
 * 실제 와이어 계약이 함께 검증된다.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.join(HERE, "..", "..");
export const FIXTURES = path.join(HERE, "..", "fixtures");
export const FIXTURE_VAULT = realpathSync(path.join(FIXTURES, "vault"));
export const DIST_CLI = path.join(PKG_DIR, "dist", "cli.js");

export interface TextContent {
  type: string;
  text: string;
}
export interface ToolResult {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface Connected {
  client: Client;
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  close: () => Promise<void>;
}

/** 픽스처(또는 임시) 볼트 위에 서버·클라이언트를 InMemory 로 연결한다. root 는 realpath 정규화된 값을 넘길 것.
 *  기본은 **실제 서버 기본값과 같은 텍스트 전용**(P4-27+, 외부리뷰: 헬퍼가 opt-in 을 기본으로 두면 사용자 경로가 검사되지 않는다).
 *  structuredContent·outputSchema 계약을 검사하는 테스트만 `connect(root, { structured: true })` 로 명시한다. */
export async function connect(root: string, opts: { structured?: boolean } = {}): Promise<Connected> {
  const server = createServer({ root, version: "0.1.0", structured: opts.structured ?? false });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "p2-test", version: "0" });
  await client.connect(ct);
  await client.listTools(); // outputSchema 검증기 캐시 (Client.callTool 이 structuredContent 를 검증하게 함)
  return {
    client,
    call: async (name, args) => (await client.callTool({ name, arguments: args })) as unknown as ToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function text(r: ToolResult): string {
  return r.content[0]?.text ?? "";
}

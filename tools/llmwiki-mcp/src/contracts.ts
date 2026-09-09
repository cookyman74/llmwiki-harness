/**
 * contracts.ts — `TOOLS[].outputSchema` 의 **TS 대응물** (P3-28+, agy P2 2차 m5).
 *
 * 문제: `callTool` 이 `structuredContent: Record<string, unknown>` 을 돌려주면 필드 이름을 바꿔도 컴파일은 통과하고
 * 런타임 `validateSubset`(fail-closed) 에서만 터진다. 여기서 스키마와 1:1 대응하는 인터페이스를 선언하고
 * `server.ts` 의 도구 분기가 **그 타입의 값을 만들도록** 하면, 필드 누락·오타·타입 불일치는 `tsc` 에서 잡힌다.
 *
 * 규칙(중요): 이 파일의 인터페이스는 `tools.ts` 의 outputSchema 와 **글자 단위로 대응**해야 한다.
 * - 필수 필드 = 스키마 `required` (옵셔널 `?` = required 에 없는 필드)
 * - 필드 이름·타입·enum 리터럴 동일
 * 드리프트는 `test/unit/p3-contracts.test.ts` 가 런타임에 검사한다(인터페이스 필수키 집합 ↔ 스키마 required 배열).
 *
 * 의존성 없음(순수 타입 + 위더닝 헬퍼 1개) — `tools.ts`·`read.ts` 와 순환 import 을 만들지 않기 위해 별 파일로 둔다.
 */

/** wiki_expand.outputSchema.properties.rows.items */
export interface ExpandStructuredRow {
  tier: "seed" | "1hop" | "moc";
  refs?: number;
  score?: number;
  slug: string;
  type: string;
}

/** wiki_expand.outputSchema */
export interface ExpandStructured {
  text: string;
  rows: ExpandStructuredRow[];
  suggested_next: "wiki_pack" | "wiki_read_page" | "answer";
  truncated: boolean;
}

/** wiki_search.outputSchema.properties.rows.items */
export interface SearchStructuredRow {
  distinct: number;
  total: number;
  slug: string;
  type: string;
}

/** wiki_search.outputSchema */
export interface SearchStructured {
  text: string;
  rows: SearchStructuredRow[];
  matched: number;
  truncated: boolean;
}

/** wiki_pack.outputSchema.properties.pages.items */
export interface PackStructuredPage {
  slug: string;
  found: boolean;
  type: string;
  confidence: string;
  status: string;
  claims: string[];
  summary: string;
  relations: string[];
}

/** wiki_pack.outputSchema */
export interface PackStructured {
  text: string;
  pages: PackStructuredPage[];
  truncated: boolean;
}

/** wiki_read_page.outputSchema.properties.frontmatter */
export interface ReadPageStructuredFrontmatter {
  type: string;
  confidence: string;
  status: string;
  superseded_by?: string;
  last_confirmed?: string;
}

/** wiki_read_page.outputSchema */
export interface ReadPageStructured {
  slug: string;
  resolved_from_alias: boolean;
  path: string;
  frontmatter: ReadPageStructuredFrontmatter;
  text: string;
  truncated: boolean;
}

/** 도구 이름 → structuredContent 타입 (discriminated helper). */
export interface StructuredByTool {
  wiki_expand: ExpandStructured;
  wiki_pack: PackStructured;
  wiki_read_page: ReadPageStructured;
  wiki_search: SearchStructured;
}

export type StructuredToolName = keyof StructuredByTool;
export type StructuredFor<N extends StructuredToolName> = StructuredByTool[N];

/** 판별 유니온 형태 — `{ name, structured }` 쌍을 다루는 코드용(테스트·향후 라우팅). */
export type ToolStructured = { [N in StructuredToolName]: { name: N; structured: StructuredByTool[N] } }[StructuredToolName];

/**
 * MCP envelope 는 `structuredContent?: Record<string, unknown>` 을 받는다. TS 는 **인터페이스**에 암묵 인덱스
 * 시그니처를 주지 않으므로(타입 별칭만 받음) 여기서 한 번 넓힌다. 값은 그대로 — 런타임 동작 무변경.
 * 호출부가 `const sc: PackStructured = {…}` 처럼 먼저 타입을 붙이므로 검사는 그 지점에서 이미 끝난다.
 */
export function asStructuredContent(v: StructuredByTool[StructuredToolName]): Record<string, unknown> {
  return v as unknown as Record<string, unknown>;
}

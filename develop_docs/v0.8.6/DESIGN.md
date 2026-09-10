# 설계서 — llmwiki MCP 서버 (Node.js 포팅)

- PRD: `develop_docs/v0.8.6/PRD.md`
- 정본 알고리즘: `.claude/skills/wiki-lint/scripts/search.py`, `scope-expand.py` (v0.8.5 combo, A/B 5라운드 검증)
- 작성일: 2026-09-07

## 1. 개요 — 구성과 데이터 흐름

```
[클라이언트: Claude Code(타 프로젝트) / Codex CLI / Gemini CLI / agy / Cursor / Windsurf
             / Claude Desktop / VS Code / 자체 에이전트(MCP 클라이언트 SDK)]
        │  MCP (stdio, JSON-RPC) — 클라이언트마다 등록 문법만 다르고 서버는 동일 바이너리
        ▼
  npx -y llmwiki-mcp --root <볼트>         ← tools/llmwiki-mcp (TypeScript, 읽기 전용, 의존 2개)
        │
        ├─ wiki_search    ── search.ts   (search.py --files 포팅: lexical 파일 랭킹)
        ├─ wiki_expand    ── expand.ts   (scope-expand expand: seed→1홉→MoC Top-K [→BM25 rerank])
        ├─ wiki_pack      ── pack.ts     (scope-expand pack: claims·conf·status·관계 팩)
        └─ wiki_read_page ── read.ts     (절차 질의용 전문 read, wiki/ 하위로 제한)
        │
        ▼  fs.readFile / readdir 만 사용 (쓰기 API 0개)
  <볼트>/wiki/**/*.md   (L2·L3·L4·moc — index.md·log.md는 wiki/ 밖이라 스코프 제외, Python과 동일)
```

질의 1건의 표준 흐름(라우팅은 클라이언트 몫, 도구 description이 안내):

| 질의유형 | 호출 순서 | 근거(v0.8.5) |
|---|---|---|
| 단일조회 | `wiki_expand(kw, max=6)` → seed만 보고 답 | 최저비용 |
| 사실브리핑·비교 | `wiki_expand(kw, max=20, rerank=11)` → `wiki_pack(slugs)` 1회 | 팩 1-read로 충분, rerank 11이 균형 |
| 절차·how-to | `wiki_expand(kw, max=8)` → 후보를 `wiki_read_page`로 정독 | 팩=오버헤드, rerank는 needed 페이지 탈락 |

## 2. 패키지 구조

```
tools/llmwiki-mcp/
├── package.json          name: llmwiki-mcp · bin: llmwiki-mcp · files: [dist, README.md]
├── tsconfig.json         target ES2022 · module NodeNext · strict
├── src/
│   ├── vault.ts          walkMd()·read()·frontmatter()·field() — 공통 파서
│   ├── graph.ts          buildGraph() — slug→{type,aliases,out,in,text}, alias→slug
│   ├── search.ts         filesMode() — search.py --files
│   ├── expand.ts         lexicalSeeds()·expand()·MEMBER_K
│   ├── bm25.ts           scoreText()·bm25Rank()
│   ├── pack.ts           pack()
│   ├── read.ts           readPage() — slug 검증·경로 제한
│   ├── format.ts         Python stdout과 동일한 텍스트 렌더러(패리티용)
│   ├── tools.ts          도구 4개 계약(수기 JSON Schema 부분집합·description·instructions) + 입력 정규화·검증·상한
│   ├── server.ts         저수준 Server: tools/list·tools/call 핸들러(once.ts 함수 재사용), stdio 기동, DEBUG 타이밍
│   ├── print-config.ts   클라이언트별 등록 스니펫 생성(출력만, 파일 쓰기 없음)
│   └── cli.ts            인자 파싱(--root/--version/--selftest/--once/print-config) → server 기동
├── test/
│   ├── unit/             countSub·frontmatter·LINK·aliases·정렬 비교함수
│   └── fixtures/vault/   합성 볼트(콘텐츠 무관·한국어·BOM·이모지·코드펜스·별칭링크 케이스)
└── README.md             설치·등록 매트릭스 8종·도구 계약·한계
tests/parity.py           (저장소 루트, 기존 smoke.py 옆) Python↔Node diff
```

- 저장소는 하네스(`llmwiki-harness`). 볼트에는 설치하지 않는다 — 볼트는 `--root` 데이터일 뿐.
- 런타임 의존성은 `@modelcontextprotocol/sdk` **하나**. 빌드 산출물 `dist/`를 퍼블리시.
  > **P2 결정(2026-09-09, 실측 근거)**: 원안은 `McpServer` + zod 였으나, 인프로세스 클라이언트로 `tools/list` 를 덤프해 보니 SDK 1.30 의 zod4 경로(`z4mini.toJSONSchema`)가 `$schema`·`additionalProperties:false`·`execution:{taskSupport}` 를 자동 삽입해 §3 "스키마 부분집합" 규칙을 어겼다. 저수준 `Server`(`setRequestHandler(ListTools/CallTool)`) 에 **수기 JSON Schema**(`src/tools.ts`)를 주면 쓴 그대로 나간다 → 채택. 잃는 것: SDK 의 `structuredContent`↔`outputSchema` 자동 검증(단위 테스트 P2-09 로 대체)과 zod 입력 검증(런타임 정규화·검증 함수로 대체 — 원래 §3 이 요구한 방식). zod 는 런타임 의존에서 제거(SDK 내부 의존으로만 존재).
- Node ≥ 20 (lookbehind·`\p{}`·`fs.promises` 안정). 개발 환경 v24.

## 3. 도구 계약

공통: 모든 도구는 `content[0].text`에 **사람이 읽는 텍스트**를, `structuredContent`에 JSON을 함께 반환한다. Python 스크립트와의 **바이트 동일 보장은 `--once` CLI** 에 있다(패리티 테스트 대상). MCP 응답은 `wiki_expand` 에 `suggested_next: …` 한 줄을 덧붙이고 200KB 예산을 적용한다. 텍스트는 패리티·사람 가독용, JSON은 에이전트 파싱용. 오류는 MCP `isError: true` + 한 줄 메시지.

동일성의 정의: Python `stdout` 전체(줄 구분 `\n`, **마지막 개행 포함**)와 `--once` 출력이 바이트 동일. MCP `text`도 같은 문자열(개행 제거 안 함). Windows에서도 `\n` 고정(Python 쪽은 `sys.stdout.reconfigure(newline="\n")`을 patch 범위에 포함 — §7). 예외는 rerank 점수 열 하나(§7 허용오차).

`structuredContent`는 MCP 2025-06-18 스펙·TS SDK 표준 필드다(외부리뷰 2026-09-09에서 "비표준" 지적 → SDK 문서로 반증·기각). 각 도구에 **`outputSchema`를 선언**한다 — 선언 시 SDK가 전송 전 검증하고, 검증 클라이언트는 불일치 결과를 거부하므로 스키마와 실제 JSON을 단위 테스트로 맞춘다. 구형 클라이언트는 `content[0].text`만 보므로 텍스트가 1차 표현이다.

**입력 내결함성(외부리뷰 #6 반영).** LLM 클라이언트의 흔한 변형을 도구 진입점에서 정규화한다: `terms`가 문자열이면 공백 분할 → 배열; `slug`/`slugs` 항목은 양끝 공백·`[[`·`]]`·`.md`·`wiki/…/` 접두를 제거. 정규화 후 검증 실패는 `isError` + 어떤 입력이 왜 거부됐는지 한 줄. **정규화는 런타임(핸들러 첫 줄)에서 하고 스키마에는 드러내지 않는다** — 아래 호환 규칙 때문.

**다중 클라이언트 호환 규칙(2026-09-09 재검토).** 서버 하나가 Claude Code·Codex·Gemini CLI·agy·Cursor 등에서 그대로 동작해야 한다.
- **JSON Schema 부분집합만.** `inputSchema`·`outputSchema`는 `type: object|array|string|integer|boolean`, `properties`, `required`, `items`, `enum`, `description`, `minimum/maximum`, `minItems/maxItems`만 사용. **금지**: `anyOf/oneOf/allOf`, `$ref/$defs`, `const`, `default`, `additionalProperties`, `format`, Zod `preprocess/transform/union`이 만들어내는 스키마. Gemini 계열이 취약하고 Codex는 엄격 검증. CI에서 `tools/list` 결과를 덤프해 금지 키워드 grep.
- **도구 이름** `^[a-z][a-z0-9_]{0,63}$` (OpenAI 함수명 규칙 교집합). 현행 4개 모두 적합.
- **description은 영문 먼저 + 한국어 한 줄, ≤ 500자.** 클라이언트가 매 턴 도구 설명을 모델에 싣는다 → 4도구 합계 ≤ 2,000자. 각 description 마지막 줄은 **그 도구의 라우팅 위치 한 줄**(예: `wiki_pack` — "Use after wiki_expand(rerank=11) for factual briefings; do not read_page if claims suffice"). 전체 라우팅 표는 서버 `instructions`에만.
- **`instructions`에 의존하지 않는다.** Claude Code는 모델에 노출하지만 Codex·Gemini·Cursor는 미확인 → description 한 줄 + `suggested_next`로도 라우팅이 성립해야 한다(PRD 지표 "규칙 파일 없이 준수").
- **prompts/resources는 선택 기능.** 클라이언트 지원이 갈리므로 필수 경로에 두지 않는다. v1은 tools만.
- **`structuredContent`를 못 읽는 클라이언트**는 `content[0].text`로 동작. 텍스트가 1차 표현인 이유.
- **stdout 순수성.** transport 외 stdout 쓰기 0. `console.log` ESLint 금지, smoke가 기동 직후 stdout 첫 바이트가 `{`인지 검사.

### 3.1 `wiki_search` — lexical 파일 랭킹 (search.py --files)

| 입력 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `terms` | string[] (1~10) | — | OR 검색어. 소문자화·공백만인 항목 제거 |
| `top` | int 1~50 | 8 | 상한(fill 아님) |

출력 텍스트: 줄당 `"<distinct>/<total>\t<slug>\t<type>"`, 없으면 `"no matches for: <terms>"`.
JSON: `{rows:[{distinct,total,slug,type}]}`.
description 요지: "팩·확장 결과가 빈약할 때의 fallback. 보통은 wiki_expand를 먼저 쓴다."

### 3.2 `wiki_expand` — 그래프 확장 스코프 (+rerank)

| 입력 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `terms` | string[] (1~10) | — | 키워드 |
| `max` | int 1~50 | 15 | 확장 pool 상한 |
| `top_seed` | int 1~20 | 6 | lexical seed 수 |
| `rerank` | int 0~50 | 0 | 0=미적용. 사실브리핑은 11 권장 |

출력 텍스트(rerank=0): `"<tier>\t<refs>\t<slug>\t<type>"`, tier ∈ seed/1hop/moc.
출력 텍스트(rerank>0): `"<tier>\t<score:.1f>\t<slug>\t<type>"`.
seed 없음: `"no lexical seed for: <terms>"`.
JSON: `{rows:[{tier,refs?,score?,slug,type}], suggested_next: "wiki_pack"|"wiki_read_page"|"answer"}` — `suggested_next`는 라우팅 힌트(rerank>0→pack, max≤6→answer, 그 외→read_page).
description에 §1의 라우팅 표를 그대로 수록한다(클라이언트가 SKILL.md 없이도 규칙을 안다).

### 3.3 `wiki_pack` — claims 컨텍스트 팩

| 입력 | 타입 | 설명 |
|---|---|---|
| `slugs` | string[] (1~30) | 확장 결과 slug |

출력 텍스트: slug마다
```
## <slug>  [<type> · conf <confidence|-> · <status|active>]
- <claim>…              (claim:: 없으면 "- (요약) <첫 실문단>")
- 관계) <pred :: [[target]] …>
<빈 줄>
```
없는 slug는 `"## <slug>\n(없음)\n"`.
JSON: `{pages:[{slug,type,confidence,status,claims[],summary?,relations[]}]}`.
description 요지: "**confidence를 답에 병기**하고, `status: stale`이면 답에 쓰지 말고 superseded_by를 wiki_read_page로 따라가 active를 우선하라. claims로 충분하면 full-read 금지."

### 3.4 `wiki_read_page` — 전문 read (절차 질의)

| 입력 | 타입 | 설명 |
|---|---|---|
| `slug` | string | 파일명(확장자 없음) |

검증(**P2 개정 2026-09-09**): 길이 1~120, `/`·`\`·`..`·제어문자(`\p{Cc}`) 불포함 — 원안의 문자 클래스 `^[\p{L}\p{N}._\- ]+$` 는 기호 포함 파일명(`zz-🦀-crab`)을 거부해 `wiki_expand → wiki_pack` 흐름을 끊었다(P2 단위테스트 검출). 경계 보장은 문자 클래스가 아니라 walk 인덱스 조회 + `realpath`/`path.relative` 판정이 맡는다. `wiki/**` 아래에서 slug 일치 파일을 찾아(walk 순서·마지막 승) `realpath`가 `<root>/wiki/` 밖이면 거부.
없는 slug: 그래프의 `alias2slug`(소문자 키)로 1회 리다이렉트 시도(Python `pack`에는 없는 동작이지만 read_page는 신규 도구라 패리티 대상 아님). 그래도 없으면 `isError: true` + `"page not found: <slug>"`.
출력: 파일 전문(frontmatter 포함). JSON: `{slug, resolved_from_alias?, path(상대), frontmatter:{type,confidence,status,superseded_by?,last_confirmed?}, text}`.
description 요지: "절차·how-to 또는 팩이 불충분한 특정 주장 확인에만. 사실브리핑에서 남발 금지."

### 3.5 서버 메타

- `name: llmwiki`, `version`은 package.json. `instructions`(MCP 서버 수준 안내)에 세 줄: 읽기 전용 · 라우팅 표 · 신뢰도/stale 규약.
- 기동 시 `<root>/wiki` 존재 확인, 없으면 stderr 한 줄 + exit 2.
- `--selftest`: 픽스처 없이 root의 페이지 수·MoC 수·빌드 시간(ms)·**프로세스 기동→ready(ms)** 를 출력하고 종료(설치 확인·Codex 타임아웃 판단용).
- `print-config --client <claude-code|codex|gemini|agy|cursor|windsurf|claude-desktop|vscode> --root <볼트> [--windows] [--global]`: 해당 클라이언트의 등록 명령(CLI형) 또는 JSON/TOML 조각(설정형)을 stdout에 출력. **파일에 쓰지 않는다** — 클라이언트 설정 파일은 타 서버의 비밀키를 담고 있어 자동 편집이 위험. `--global`은 `npm i -g` 설치 전제로 `npx -y` 대신 `llmwiki-mcp` 직접 실행 형태로 출력.

## 4. 알고리즘 포팅 대응표 (정본 = Python)

원칙: **랭킹 규칙을 바꾸지 않는다.** 아래는 의미가 갈릴 수 있는 지점만 고정한다.

| # | Python | TypeScript | 비고 |
|---|---|---|---|
| 1 | `os.walk` + `sorted(files)`; 디렉터리 순서는 OS 의존 | `readdir({withFileTypes})` 후 **디렉터리·파일 모두 이름 정렬**(코드포인트) 순회 | Python 쪽도 패리티 픽스처 기준으로 디렉터리 순서를 정렬하도록 소폭 수정(§7). 중복 slug는 마지막 승 |
| 2 | `open(encoding="utf-8-sig", errors="replace")` — 텍스트 모드 **universal newlines**: `\r\n`·`\r` → `\n` 자동 변환 | `readFile` → UTF-8 디코드, 선행 `﻿` 제거, 잘못된 바이트는 U+FFFD(TextDecoder 기본), **`\r\n`→`\n` 후 잔여 `\r`→`\n`** | ⚠ 외부리뷰 #3: 변환 누락 시 CRLF 파일에서 dl·avgdl·`count`가 어긋나 BM25·lexical 불일치. 유니코드 NFC/NFD는 **양쪽 모두 정규화 안 함**(Python 정본이 안 하므로; 패리티 유지). 한계에 기재 |
| 3 | frontmatter: 첫 줄 `---`, 이후 **200줄 내** 닫는 `---` | 동일. `split("\n")` 기준(#2에서 개행 정규화 완료) | `.gitattributes`가 LF 강제하나 볼트는 사용자 파일이라 CRLF 허용 → 픽스처에 CRLF 파일 포함 |
| 4 | `field`: `^name:\s*(.+)$` MULTILINE, `strip()` | `new RegExp("^"+name+":\\s*(.+)$","m")`, `trim()` | `.+`는 줄 내(JS `.`도 개행 불일치) |
| 5 | `type` 기본값 — `build_graph`(expand)·search.py 는 **부모 디렉터리명**, `do_pack` 헤더는 **`?`** (`field(fm,"type") or "?"`) | 동일하게 **비대칭 유지** — graph/search 는 dirname, pack 헤더는 `?` | Python 정본의 비대칭(P0 외부리뷰 지적). 픽스처 q14: search 는 `L4-procedural`, pack 은 `[? · conf - · active]` |
| 6 | aliases 파싱: `strip("[] ")` 후 `[^\[\],]+` findall, 각 `strip().strip("'\"")` | 동일 순서. `strip("[] ")`는 양끝에서 `[`·`]`·공백 문자 집합 제거임(문자열이 아님) | 헬퍼 `stripChars(s, "[] ")` |
| 7 | `LINK = (?<!!)\[\[([^\]|#]+)` | 동일, V8 lookbehind 지원. `g` 플래그 matchAll | `![[…]]` 임베드 제외 |
| 8 | 링크 정규화: 원문 slug 존재 → 그대로, 아니면 `alias2slug[lower]`; 자기링크 제외 | 동일 | alias 등록은 `setdefault`(먼저 등록한 것이 이김) → `Map.has` 체크 후 set |
| 9 | `str.lower()` | `toLowerCase()` | 한국어·ASCII 동일. 특수 케이스(İ 등) 무시 |
| 10 | `hay.count(t)` — **비중첩** 부분문자열 수 | `countSub(hay,t)`: `indexOf` 루프, `i += t.length` | `split(t).length-1`은 빈 문자열 예외 → 사용 금지 |
| 11 | lexical 정렬 `(-distinct, -total, slug)` — Python 문자열 비교는 **코드포인트** 순 | 비교함수 동일 순서, 마지막 slug는 `cmpCodePoint(a,b)` 헬퍼(`codePointAt` 순회) | JS `<`는 UTF-16 코드유닛 비교라 non-BMP(이모지) vs U+E000~FFFF에서 역전(외부리뷰 #9). `localeCompare` 금지 |
| 12 | `expand`: cand[n]=[tier,refs], seed는 `[0,99]`, `bump`는 tier=min·refs+=1 | 동일 | seed refs 99는 정렬용 |
| 13 | MoC 멤버 정렬 `(-lex, m)` 후 `MEMBER_K=6` | 동일 | |
| 14 | tier1 필터 `lex>0 or refs>=2`; 최종 정렬 `(tier, -lex, -refs, slug)` → `[:max]` | 동일 | |
| 15 | `_score_text`: `\]\([^)]*\)`→`]`, `https?://\S+`→`""`, lower | 동일 regex(`g`) | `\S` 의미 동일 |
| 16 | BM25: terms 중복제거·길이<2 제외, N=전체, avgdl=문자 길이 평균, idf=`log((N-df+.5)/(df+.5)+1)`, df=`t in tx` | 동일. `Math.log`. dl은 **문자열 length**(UTF-16 코드유닛) vs Python **코드포인트** | ⚠ 서로게이트 쌍(이모지 등)에서 dl 차이 → **`[...tx].length`로 코드포인트 수 사용** |
| 17 | rerank 정렬 `(-score, slug)`, 출력 `score:.1f` | `fmt1(x)` 전용 헬퍼(**`toFixed` 직접 사용 금지**) | **확인됨(2026-09-09)**: 정확한 tie에서 다름 — `0.25` → Python `0.2`(half-even) / JS `toFixed` `0.3`(큰 쪽). `fmt1`: `x*10`이 정확히 `.5`로 끝나면 half-even, 아니면 `toFixed(1)`. 단위 테스트에 0.25·0.35·2.45·0.0·음수 케이스. 추가로 `Math.log`(V8) vs `math.log`(libm)가 1 ULP 다를 수 있어 `.x5` 경계에서 플랫폼별 뒤집힘 가능(외부리뷰 #5) → **점수 열은 바이트 동일 대상에서 제외, §7 허용오차** |
| 17b | 미매치 메시지: search.py `no matches for: {소문자화 terms}` / scope-expand.py `no lexical seed for: {원본 terms}` | 각각 동일 — search는 소문자, expand는 **원본 대소문자 유지** | 두 스크립트가 다르다(외부리뷰 #7). 통일하지 않고 그대로 재현. 픽스처에 대문자 질의 포함 |
| 18 | pack claims: `^-?\s*claim::\s*(.+)$` MULTILINE, **코드펜스 무시 없음**(문서 전체 스캔) | 동일(`gm`). 관계 추출(#20)과 달리 **펜스 토글을 적용하지 않는다** | 비대칭이지만 정본 동작(외부리뷰 #8). "일관성" 명목의 수정 금지. 픽스처에 펜스 안 `claim::` 케이스 |
| 19 | pack 요약: `text.split("---",2)[-1]` 후 첫 줄 중 `t[0] not in "#!>|-"` and not `startswith("[")` | `split("---")`는 Python `maxsplit=2`와 다름 → 헬퍼로 **앞 2개 구분자만** 분리 | |
| 20 | 관계: `-\s*([\w-]+\s*::\s*\[\[[^\]]+\]\].*)$`, 코드펜스 토글, `claim` 접두 제외 | `[\p{L}\p{N}_-]+` + `u` 플래그 | Python `\w`=유니코드. JS `\w`=ASCII → 그대로 쓰면 한국어 술어 탈락 |
| 21 | `--top-seed`·`--max`·`--rerank` 기본 6·15·0 | 동일 | |

이 표는 `test/unit`의 케이스 목록이기도 하다. 각 행에 대응하는 단위 테스트를 둔다.

## 5. 보안·격리

- **쓰기 API 0개.** `fs` import는 `readFile`·`readdir`·`stat`·`realpath`만. CI에서 `grep -E "writeFile|appendFile|unlink|rename|mkdir|rm(Sync)?\(" src/`가 0건이어야 통과.
- **순회 단계 심볼릭 링크 차단(외부리뷰 #1, BLOCKER).** `read_page`만 검증하면 부족하다 — `buildGraph`의 `walkMd`가 `wiki/leak.md → ../CLAUDE.local.md` 같은 링크를 읽어 그래프에 적재하면 `wiki_search`·`wiki_pack`으로 유출된다. `walkMd`는 `readdir({withFileTypes})`에서 **심볼릭 링크 엔트리(파일·디렉터리 모두)를 건너뛰고**, 추가로 각 `.md`의 `realpath`가 `<root>/wiki/` 하위가 아니면 제외한다(stderr 경고 1줄, 내용 로그 금지). Python 정본은 이 검증이 없으나 픽스처에는 심볼릭 링크를 두지 않으므로 패리티에 영향 없음. 실 볼트 한계에 "wiki/ 안 심볼릭 링크는 무시됨" 기재.
- **경로 제한.** 모든 파일 접근은 `<root>/wiki/` 하위 실경로만. `wiki_read_page`는 §3.4 검증. `--root` 자체는 `realpath`로 정규화. 접두 비교는 문자열 `startsWith`가 아니라 `path.relative(wikiReal, targetReal)`이 `..`로 시작하지 않고 절대경로가 아닌지로 판정(Windows 구분자·대소문자 무시 FS·`wiki2/` 같은 접두 우회 방지).
- **입력 상한.** terms ≤10개·각 ≤64자, slugs ≤30, 응답 텍스트 ≤ 200KB **UTF-8 바이트**(코드포인트 경계 보존, 초과 시 절단 + `truncated: true`). pack 의 `structuredContent.pages` 도 같은 예산(P2 리뷰: text 만 자르면 우회).
- **자원 상한(P2 리뷰).** 파일 1개 ≤16MiB, 파일 수 ≤20,000 — 초과 시 결과를 조용히 바꾸지 않고 `VaultLimitError`(도구 isError / `--once` exit 1). 동시 도구 호출 ≤4(세마포어).
- **TOCTOU 완화(P2 리뷰).** `read()` 는 `O_NOFOLLOW` 로 열어 realpath 검사 뒤 최종 구성요소가 링크로 바뀌어도 따라가지 않는다(POSIX; Windows 는 상수 없음). 상위 디렉터리 교체 경쟁은 로컬 단일 사용자 도구 범위에서 수용 — 원격/멀티테넌트 노출 시 재검토.
- **읽기 전용 가드는 허용목록.** CI 가 `src/` 의 `fs.*`/`fh.*` 멤버를 추출해 readFile·readdir·stat·realpath·open(읽기 플래그)·close·constants 외면 실패. 대괄호 접근·동적 접근 금지.
- **print-config 안전.** 서버 이름 `^[A-Za-z][A-Za-z0-9_-]{0,63}$`(셸·TOML 삽입), root 개행·NUL 거부. **Windows 출력은 볼트 경로를 명령 인자에 넣지 않는다**(`cmd /c` 가 `&`·`|`·`%VAR%` 해석) — env 전달만. CLI 형의 `--env` 값은 cmd.exe 인용(큰따옴표). **`%` 는 이스케이프 불가**(대화형 cmd 는 따옴표 안에서도 확장, `%%` 는 배치 전용) → `%`·`!` 가 든 경로는 CLI 형 등록을 거부하고 JSON 설정형(env)을 안내한다.
- **볼트 루트 검증(P2 2차 리뷰).** `resolveRoot` 를 서버·`--selftest`·`--once` 가 공유: root realpath, `wiki/` 는 **비링크 디렉터리**이고 `realpath(wiki) == <rootReal>/wiki` — `root/wiki → 외부` 링크가 walkMd 경계를 통째로 우회하던 결함 차단. 오류 메시지는 입력 문자열만 반영(realpath 비노출), `--selftest` 는 basename+해시(`--show-root` 로 전체).
- **원시 입력 가드.** terms/slugs 문자열 ≤4,096자·배열 ≤256항목을 분할·순회 **전에** 검사. 볼트: 파일 ≤20,000·디렉터리 ≤5,000·깊이 ≤32·누적 텍스트 ≤512MiB·파일 ≤16MiB.
- **`--once` 계약.** Python 패리티 도구이므로 200KB 절단을 적용하지 않는다. P2-33 "같은 코드 경로" = 절단 전 리트리벌 텍스트 동일.
- **콘텐츠 비유출.** 패키지 `files` 화이트리스트(`dist/`, `README.md`). CI에서 `npm pack --dry-run` 목록에 `.md`가 README 외 0개.
- **로그.** stdout은 MCP 전용. 진단은 stderr, 기본 quiet. `LLMWIKI_DEBUG=1`이면 도구별 소요(ms)만 — 질의어·페이지 내용은 로그 금지.

## 6. 성능

- v1: 호출마다 `buildGraph` (Python과 동일 동작). 실 볼트 315 페이지 기준 Python <1s → Node 동급 예상. 파일 read는 `fs.promises.readFile`을 동시성 32로 병렬(순서는 정렬된 목록 기준으로 재조립). 파일을 조용히 **스킵하지 않는다**(Python 과 결과가 달라지므로 — 외부리뷰 #12). 대신 P2 리뷰 반영으로 16MiB 초과 시 **명시적 오류**(VaultLimitError)로 실패한다 — 결과를 바꾸지 않으면서 무제한 read 를 막는 절충(§5). stdio 서버는 단일 클라이언트라 이벤트 루프 블로킹은 수용.
- v1.1(**2026-09-10 구현 — P4**, 외부리뷰 1차 반영): 프로세스 내 캐시 `src/cache.ts`. 호출 시 `walkMd`(경계 검사 포함) + `lstat` 스캔으로 변경 감지 → 변경 파일만 재파싱, 그래프는 통째 재구성(인링크 때문). 패리티는 캐시 on/off 양쪽 실행(픽스처 56 · 실볼트 20 · 퍼징 200, 전부 동일 — CI 에 on/off 두 단계로 고정).
  - **캐시 키** = 볼트 realpath + 파일별 `(경로, dev, ino, mode, size, mtimeNs, ctimeNs)`. `ctime` 이 핵심이다 — 내용·권한·이름이 바뀌면 커널이 올리고 userland 가 되돌릴 수 없어서 `cp -p`·`rsync --times`·`touch -t` 로 mtime·size 를 복원해도 적중하지 않는다(codex 1차 BLOCKER-1). `dev`·`ino`·`mode` 가 들어가므로 파일이 다른 파일·심볼릭 링크로 교체돼도 미스다(codex 1차 BLOCKER-2). Node 의 `ctime` 은 POSIX·NTFS 모두 **상태 변경 시각**이다(생성 시각은 `birthtime` — Node v24 공식 문서 "Stat time values"). 1차 반영 때 "Windows ctime = 생성 시각" 이라 적은 것은 오류였고 2차 리뷰(codex B3)가 그 문장을 근거로 삼았다 → 정정. 방어가 실제로 성립하지 않는 곳은 **FAT/exFAT·일부 네트워크 FS**(변경 시각 없음/약함)이며 README 한계에 `LLMWIKI_CACHE=0` 권고로 기재.
  - **순회는 캐시하지 않는다.** 심볼릭 링크 스킵·realpath 경계(§5)는 호출마다 그대로 수행되고 캐시는 그 뒤에 붙는다 — 캐시 적중이 보안 규칙을 우회할 수 없다.
  - **타임스탬프 해상도 방어**: 스냅샷에 최근 2s(`FRESH_WINDOW_MS`) 안에 수정된 파일이 있으면 '불안정'으로 보고 **저장도, 기존 캐시 사용도 하지 않는다**(그래프 적중·텍스트 재사용 모두 금지, 전량 재독 — codex 2차 BLOCKER-1: 저장만 막고 적중은 허용하던 구멍). 단 `FUTURE_SKEW_MS`(5s)보다 더 미래인 mtime 은 시계 차이로 보고 캐시를 막지 않는다 — 막으면 미래 타임스탬프 파일 하나가 그 볼트의 캐시를 영구 무력화한다(agy 1차 BLOCKER-1).
  - **파생값도 캐시한다**(P4-13+): lex haystack·bm25 `scoreText`·`dl` 은 term 과 무관해 노드 수명 동안 재사용한다(WeakMap). 예산은 그래프를 새로 조립할 때 리셋한다(agy 1차 BLOCKER-2: 전역 카운터가 계속 늘면 상한 초과 후 파생 캐시가 영구히 멈춘다). 측정 분해에서 buildGraph 는 호출 비용의 29% 뿐이라 그래프만 캐시하면 ROI 가 나지 않는다.
  - **메모리**: 텍스트 캐시 root 당 256MiB — 넘으면 **그래프도 저장하지 않는다**(그래프가 본문을 쥐고 있어 텍스트 상한을 우회하던 구멍, codex 2차 MAJOR-1). 파생 메모 128MiB 는 **살아 있는 전 root 의 합**으로 계산하고, 저장된 그래프의 노드에만 매단다(세대 번호로 확인). 볼트 4개까지 LRU 로 유지(`MAX_ROOTS`)하되 **전 root 텍스트 합 512MiB**(`TOTAL_TEXT_BUDGET_BYTES`)를 넘으면 가장 오래 안 쓴 다른 root 를 비운다(codex 3차 MAJOR-2). 누적 상한 `MAX_TOTAL_BYTES` 는 캐시 적중분까지 **읽는 즉시** 센다(codex 3차 MAJOR-1). 상한은 전부 문자열 payload 기준 논리 상한이며 RSS 상한이 아니다. 스냅샷 lstat 은 동시성 64 풀(agy 3차 MINOR-1). 프로세스 종료 시 소멸, 디스크 캐시 없음.
  - **상위 디렉터리 교체 경쟁(codex 2차 BLOCKER-2)은 캐시가 늘리지 않는다**: walk 뒤에 상위 디렉터리가 외부 링크로 바뀌어 한 호출이 외부 본문을 읽어도, 그 본문은 외부 파일의 `dev/ino` 로 키가 잡힌다. 다음 호출에서 교체가 유지되면 walkMd 의 realpath 검사가 그 파일을 빼고, 원복되면 신원이 달라 미스가 난다 — **어느 쪽이든 캐시된 외부 본문은 다시 제공되지 않는다.** 노출 범위는 캐시가 없을 때의 한 호출과 같고, 그 잔여 위험 자체는 P2-42+ 가 로컬 단일 사용자 범위에서 수용한 것이다(Node 에 `openat` 계열 API 가 없어 구성요소 고정 순회는 불가).
  - **끄는 스위치**: `LLMWIKI_CACHE=0` 이면 stat 스캔조차 하지 않고 v1 경로로 간다.
  - 실측(인프로세스 median of 10): 309p off 48.4 → **2회차 9.2ms**(-81.6%) · 1,000p off 195.4 → **26.4ms**(-87.0%) · 2,000p off 379.5 → **48.9ms**. warm 의 고정 비용은 walk+lstat 스캔(309p 6.1 · 1,000p 19.3 · 2,000p 35.6ms)이다.
- OneDrive 온디맨드 파일(클라우드 전용 상태)은 첫 read가 느릴 수 있음 → README 한계에 기재.

## 7. 패리티 테스트 (`tests/parity.py`)

```
for mode in [search --files, expand, expand --rerank 11, pack]:
  for q in QUERIES(14):           # 픽스처 볼트 대상(test/fixtures/queries.json), 한국어·영문·혼합·대문자·미매치 포함. P0에서 12→14(q13 MoC-as-seed, q14 type 기본값)
                                  # Python·Node 실행은 concurrent.futures 로 병렬(직렬 56회 ≈7s → P0 리뷰 지적)
    py  = run(python3 scope-expand.py|search.py … --root fixtures/vault)
    node= run(node dist/cli.js --root fixtures/vault --once <tool> <json>)   # --once: 서버 없이 도구 1회 실행 후 텍스트 출력
    assert py == node  (바이트 비교, 실패 시 unified diff 출력)
    # 예외: expand --rerank 모드는 파서 기반 — tier·slug·type 열과 **행 순서**는 정확 일치,
    #       score 열은 |py−node| ≤ 0.05 허용(1 ULP log 차이 흡수, 외부리뷰 #5). 순서 역전은 실패.
```

- **실 볼트 로컬 패리티(외부리뷰 #10)**: `python tests/parity.py --vault <경로>` — 대표 질의 5개를 같은 방식으로 diff. 볼트가 없으면 스킵(CI). 릴리즈 체크리스트 항목이며 결과를 릴리즈 노트에 1줄 기록.

- **픽스처 볼트** `tools/llmwiki-mcp/test/fixtures/vault/wiki/` — 페이지 ≈25개(L2 5·L3 15·moc 3·L4 2). 케이스: BOM, CRLF, 별칭 링크, 이미지 임베드, 코드펜스 안 가짜 관계, **코드펜스 안 `claim::`**(#18 비대칭), 이모지 본문(dl 차이), non-BMP 문자 slug(#11 정렬), `claim::` 없음 페이지, stale+superseded 쌍, 중복 slug(디렉터리 다른 동명 파일), 큰 MoC(멤버 10+), **대문자 질의어**(#17b). 심볼릭 링크는 두지 않는다(git 이식성·Python 미검증).
- **Python 소폭 수정 1건**(정본 유지 범위): `walk_md`(scope-expand.py)·`files_mode`/`line_mode`(search.py)의 `os.walk`에서 디렉터리 순회도 정렬(`dirs.sort()`)해 OS 무관 결정성 확보 + stdout `newline="\n"` 고정. 랭킹 규칙 무변경. smoke.py 통과 확인. 실 볼트에서 수정 전후 대표 질의 출력 동일함을 확인해 회귀 없음을 기록.
- CI: 기존 `smoke` 잡 옆에 `parity` 잡(동일 OS 매트릭스, setup-node 20 + setup-python). `npm ci && npm run build && python tests/parity.py`.

## 8. 등록 매트릭스·클라이언트 안내

문법은 2026-09-09 로컬 실측(`agy mcp add --help`, `codex mcp add --help` 0.153.4, `~/.gemini/settings.json`, `~/.cursor/mcp.json`) 기준. `print-config`가 아래를 생성한다. `<VAULT>`는 절대경로. 인용은 `print-config` 가 처리한다 — POSIX 는 위험 문자가 있을 때만 **작은따옴표**(`$`·백틱·`!` 완전 차단), 안전한 경로는 인용 없이 그대로.

```bash
# Claude Code — 사용자 범위(모든 프로젝트에서 보임)
claude mcp add --scope user llmwiki -- npx -y llmwiki-mcp --root "<VAULT>"

# Codex CLI (0.153.4 실측 — P3) — `-c mcp_servers.<name>.startup_timeout_sec=60` 을 add 와 함께 주면
#   "invalid transport" 로 **실패**한다(-c 가 command 없는 테이블을 먼저 만든다). 플래그 없이 등록하고
#   타임아웃이 필요하면 config.toml 을 편집한다. npx 콜드스타트 실측 5.8s(캐시 비운 tarball) < 기본 10s.
codex mcp add llmwiki -- npx -y llmwiki-mcp --root "<VAULT>"
#   또는 ~/.codex/config.toml
#   [mcp_servers.llmwiki]
#   command = "npx"
#   args = ["-y", "llmwiki-mcp", "--root", "<VAULT>"]
#   startup_timeout_sec = 60

# agy — 플래그는 name 앞, '-'로 시작하는 인자 앞에 '--'
agy mcp add llmwiki -- npx -y llmwiki-mcp --root "<VAULT>"

# Gemini CLI — ~/.gemini/settings.json (또는 gemini mcp add llmwiki npx -y llmwiki-mcp --root "<VAULT>")
{ "mcpServers": { "llmwiki": { "command": "npx",
    "args": ["-y", "llmwiki-mcp", "--root", "<VAULT>"] } } }

# Cursor(~/.cursor/mcp.json) · Windsurf(~/.codeium/windsurf/mcp_config.json) · Claude Desktop(claude_desktop_config.json)
{ "mcpServers": { "llmwiki": { "command": "npx", "args": ["-y", "llmwiki-mcp"],
    "env": { "LLMWIKI_ROOT": "<VAULT>" } } } }        # env 블록 지원 → 경로 인용 문제 회피

# VS Code (Copilot) — .vscode/mcp.json 은 최상위 키가 "servers"
{ "servers": { "llmwiki": { "type": "stdio", "command": "npx",
    "args": ["-y", "llmwiki-mcp", "--root", "<VAULT>"] } } }

# Windows — JSON 설정형 클라이언트는 npx 직접 실행 불가 → cmd 래핑
{ "command": "cmd", "args": ["/c", "npx", "-y", "llmwiki-mcp", "--root", "<VAULT>"] }

# 콜드스타트·타임아웃 회피 대안 — 전역 설치 후 직접 실행
npm i -g llmwiki-mcp   →   command: "llmwiki-mcp", args: ["--root", "<VAULT>"]

# 자체 에이전트 — MCP 클라이언트 SDK(stdio). LangGraph는 langchain-mcp-adapters로 동일 command/args 지정
```

**클라이언트 규칙 스니펫(선택).** 원본 하나 `templates/mcp-client-guide.md`(라우팅 표 §1 + 규약 3줄: 신뢰도 병기·stale은 superseded_by 추적·읽기 전용, 파일링은 볼트 wiki-ops) → 파생:
- Claude Code: `~/.claude/skills/llmwiki-query/SKILL.md` (트리거 "위키에 뭐라고", "llmwiki 참고")
- Codex: `~/.codex/AGENTS.md` 조각 · Gemini: `~/.gemini/GEMINI.md` 조각 · Cursor: `.cursor/rules/llmwiki.mdc`
- agy: 스킬/플러그인 체계 확인 후 결정(미확인) — 없으면 규칙 없이 서버 자기서술로만.
**없어도 동작이 요구사항**(PRD ②·지표 "규칙 파일 없이 준수")이며 스니펫은 준수율 보조.

- 볼트 안 `wiki-query`·`wiki-ops`는 **변경 없음**(계속 Python 스크립트 직접 호출). MCP는 볼트 밖 전용.

## 9. 배포·버전·롤백

- **단계**: P1 포팅+단위+패리티 → P2 MCP 서버+`--once`+Inspector 확인 → P3 README·스킬·npm publish 0.1.0·CI → P4(후속) 캐시 v1.1.
- **버전**: 하네스 태그 `v0.11.0`(외부 인터페이스 신설). npm은 독립 semver, 랭킹 규칙 변경 시 npm minor + 하네스 동시 태그.
- **동기 규칙(CLAUDE.md에 추가)**: "리트리벌 규칙 변경은 Python 스크립트·TS 포팅·패리티 픽스처 3점을 한 PR에서 함께 고친다."
- **롤백**(P3 실증): 클라이언트별 제거 → `claude mcp remove <name>` · `codex mcp remove <name>` · `agy mcp remove <name>` · JSON 설정형(gemini·cursor·windsurf·claude-desktop·vscode)은 해당 `mcpServers`/`servers` 블록 삭제. 전역 설치는 `npm rm -g llmwiki-mcp`. 규칙 스니펫은 `~/.claude/skills/llmwiki-query/`·`~/.agents/skills/llmwiki-query/`·`~/.codex/AGENTS.md`·`~/.gemini/GEMINI.md`·`.cursor/rules/llmwiki.mdc` 에서 제거. 배포 철회는 `npm deprecate llmwiki-mcp@<ver> "<사유>"`(설치는 계속 가능하되 경고), 되돌릴 수 없는 삭제는 72시간 내 `npm unpublish` 뿐이므로 원칙적으로 deprecate + 다음 patch 로 대응. 볼트 하네스는 영향 없음(Python 경로 독립).

## 10. 열린 결정 (착수 전 확정)

| 항목 | 기본안 | 대안 |
|---|---|---|
| npm 이름 — **확정 2026-09-09(P0-01)**: `llmwiki-mcp` | `llmwiki-mcp`(미등록 재확인 2026-09-09) | `@cookyman/llmwiki-mcp` 스코프 |
| `wiki_read_page` 전문 상한 — **확정 2026-09-09(P0-04)**: 200KB 절단 | 200KB 절단 | 절 단위 페이징(후속) |
| Python 디렉터리 정렬 수정 — **확정 2026-09-09(P0-03)**: 포함 | 포함(정본 결정성 확보) | 픽스처를 단일 디렉터리로 제한해 회피 |
| `--once` CLI 모드 — **확정 2026-09-09(P0-02)**: 포함 | 포함(패리티·디버그용) | Inspector로만 검증 |
| **구현 언어·정본(외부리뷰 #4)** — **확정 2026-09-09: TS 포팅** | TS 포팅 + Python 정본 유지(구현 2벌, 패리티 CI). 근거: Codex CLI·Gemini CLI·Claude Code가 npm 패키지라 대상 머신에 Node가 **보장**되고 Python/uv는 보장되지 않음 → "사전 설치물 0개" 충족은 Node만 가능 | (a) FastMCP + `uvx` — 기각(Python 런타임 비보장) (b) TS 단일 정본 수렴 — 규칙 변경 빈도 높으면 v1.x 재검토 |

## 11. 외부리뷰 반영 기록 (agy, 2026-09-09)

| # | 심각도 | 판정 | 반영 위치 |
|---|---|---|---|
| 1 심볼릭 링크 순회 유출 | BLOCKER | **수용** | §5 |
| 2 `structuredContent` 비표준 | BLOCKER | **기각** — MCP 2025-06-18·TS SDK 표준(`outputSchema` 동반). 대신 outputSchema 선언 의무화 | §3 공통 |
| 3 CRLF universal newlines·NFC | BLOCKER | CRLF **수용** / NFC **기각**(Python도 안 함 → 패리티 유지, 한계 기재) | §4 #2 |
| 4 uvx/FastMCP 대안·2벌 부채 | MAJOR | **사용자 결정으로 상신** — 기술적으로 타당한 대안. 문서의 선택은 사용자 스택 선호 기반 | §10 |
| 5 log 1 ULP → 점수 flaky | MAJOR | **수용** — rerank 점수 열 허용오차 | §4 #17, §7 |
| 6 입력 변형 내결함성 | MAJOR | **수용** | §3 공통 |
| 7 미매치 메시지 대소문자 | MAJOR | **수용** — 그대로 재현 | §4 #17b |
| 8 claims 펜스 비대칭 | MAJOR | **수용** — 수정 금지 명기 | §4 #18 |
| 9 코드포인트 정렬 | MINOR | **수용** | §4 #11 |
| 10 실 볼트 패리티 자동화 | MINOR | **수용** — `--vault` 모드 | §7 |
| 11 read_page 부재·alias | MINOR | **수용** | §3.4 |
| 12 파일 크기 상한·비동기 | MINOR | 비동기 **수용** / 크기 상한 **기각**(패리티 파괴) | §6 |

## 12. 다중 클라이언트 재검토 (2026-09-09, 사용자 요구)

"Claude Code만이 아니라 Codex·Gemini(agy)·Cursor 등도 손쉽게 설치해 써야 한다"는 요구로 재검토. 변경 요지:
- 대상 클라이언트 8종을 PRD §1 표로 명시하고 그 표를 인수 매트릭스로 삼음(5종 필수).
- 서버를 **자기서술**로 설계 — 라우팅 규약을 instructions·description·`suggested_next` 3중으로 심어 클라이언트 규칙 파일 없이 동작. 규칙 스니펫은 선택(§8).
- 스키마 **부분집합 제한**·도구명 규칙·description 길이 상한·stdout 순수성 등 호환 규칙 신설(§3 공통).
- `print-config` 서브커맨드(출력만)·`--global` 대안·Windows `cmd /c`·Codex `startup_timeout_sec` 실측 반영(§3.5·§8).
- 열린 결정 #4(언어)를 **Node 확정**으로 종결 — 근거는 클라이언트 런타임 보장(§10).

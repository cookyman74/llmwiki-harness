# P2 — MCP 서버: 도구 4개 · 호환 규칙 · 보안 · CLI 서브커맨드

```
status: done               # not-started | in-progress | review | done
started: 2026-09-09
completed: 2026-09-09
external_review: done → review/P2-codex-{2026-09-09,r2-2026-09-09,r3-2026-09-09}.md · P2-agy-{2026-09-09,r2-2026-09-09}.md
branch: feat/mcp-p2-server (base: feat/mcp-p1-port, PR #20 위에 스택)
```

- 근거: `../DESIGN.md §3`(도구 계약·다중 클라이언트 호환 규칙), `§3.5`(서버 메타·CLI), `§5`(보안), `§6`(성능), `../PRD.md §2 ②③, §5`
- 선행 조건: **P1 done** (리트리벌 함수·`--once` 존재)
- 완료 표시 방법: `00-README.md` 규칙

## 체크리스트

### A. 서버 골격 `src/server.ts`
- [x] P2-01 `McpServer({name: "llmwiki", version: package.json})`, stdio transport ✅ 2026-09-09 — server.ts `new Server({name:'llmwiki',version}, {capabilities:{tools:{}}, instructions})` + StdioServerTransport. **저수준 Server 채택**(McpServer+zod 는 `$schema`·`additionalProperties`·`execution` 자동 삽입 — 실측, DESIGN §2 결정 기록)
- [x] P2-02 `instructions` 3줄 — 읽기 전용 / 라우팅 표(§1) / 신뢰도 병기·stale→superseded_by 추적 ✅ 2026-09-09 — tools.ts SERVER_INSTRUCTIONS 3줄(읽기 전용 / 라우팅 표 / confidence·stale→superseded_by). 인프로세스 클라이언트 getInstructions() 로 확인
- [x] P2-03 기동 시 `<root>/wiki` 존재 확인, 없으면 stderr 1줄 + exit 2. root 는 `--root` → `LLMWIKI_ROOT` → 오류 ✅ 2026-09-09 — cli.ts resolveRoot: `--root`→`LLMWIKI_ROOT`→ArgError exit 2, realpath, `wiki/` 디렉터리 확인
- [x] P2-04 stdout 은 transport 전용 — 진단은 stderr, 기본 quiet, `LLMWIKI_DEBUG=1` 이면 도구별 소요(ms)만(질의어·내용 금지) ✅ 2026-09-09 — server.ts debugLog: stderr 전용, `LLMWIKI_DEBUG=1` 일 때 `<tool> <ms>` 만(질의어·내용 없음). stdout 은 transport

### B. 도구 4개 (P1 함수 재사용, `--once` 와 동일 코드 경로)
- [x] P2-05 `wiki_search` — 입력 `terms[] (1~10, 각 ≤64자)`, `top (1~50, 기본 8)`; 텍스트 + JSON `{rows}` ✅ 2026-09-09 — tools.ts wiki_search 스키마(terms 1~10·≤64, top 1~50 기본 8) + server.ts callTool → once.searchData → text+`{text,rows,matched,truncated}`
- [x] P2-06 `wiki_expand` — `terms[]`, `max (1~50, 15)`, `top_seed (1~20, 6)`, `rerank (0~50, 0)`; JSON `{rows, suggested_next}` — rerank>0→`wiki_pack`, max≤6→`answer`, 그 외→`wiki_read_page` ✅ 2026-09-09 — wiki_expand(max 1~50/15, top_seed 1~20/6, rerank 0~50/0) → `{text,rows[tier,refs|score,slug,type],suggested_next,truncated}`; suggestedNext: rerank>0→wiki_pack, max≤6→answer, else wiki_read_page(실측 rerank 11 → wiki_pack)
- [x] P2-07 `wiki_pack` — `slugs[] (1~30)`; 텍스트(Python 동일) + JSON `{pages:[{slug,type,confidence,status,claims,summary?,relations}]}` ✅ 2026-09-09 — wiki_pack(slugs 1~30) → once.packData → Python 동일 텍스트 + `{pages[slug,found,type,confidence,status,claims,summary,relations]}`
- [x] P2-08 `wiki_read_page` — `slug`; 검증 `^[\p{L}\p{N}._\- ]{1,120}$`(u), `/`·`\`·`..` 불포함; alias 1회 리다이렉트; 없으면 `isError` `page not found: <slug>`; 200KB 절단 + `truncated: true`; JSON 에 frontmatter 요약(type·confidence·status·superseded_by·last_confirmed) ✅ 2026-09-09 — read.ts readPage: normalizeSlug(`^[\p{L}\p{N}._\- ]{1,120}$`u, `/`·`\`·`..` 금지) → walk 마지막 승 → alias2slug 1회 리다이렉트(실측 `별칭페이지`→concept-alias-target) → 없으면 isError `page not found: <slug>` → realpath 경계 → 200KB 절단; frontmatter 요약(type·confidence·status·superseded_by·last_confirmed, 겉따옴표 제거)
- [x] P2-09 모든 도구에 `outputSchema` 선언, `structuredContent` 와 단위 테스트로 일치 확인 ✅ 2026-09-09 — test/unit/p2-09-output-schema.test.ts: 4도구 structuredContent 를 outputSchema 로 검증(자체 부분집합 검증기) + SDK Client 가 outputSchema 로 이중 검증. search/expand/pack 은 text == structuredContent.text
- [x] P2-10 응답 텍스트 상한 200KB, 초과 시 절단 + `truncated: true` ✅ 2026-09-09 — tools.ts capText(TEXT_LIMIT 200KB, `…[truncated at 200 KB]` 마커 + truncated:true) 4도구 공통

### C. 다중 클라이언트 호환 규칙 (§3 공통)
- [x] P2-11 입력 정규화는 **핸들러 첫 줄(런타임)** 에서 — `terms` 문자열→공백 분할, slug 양끝 공백·`[[`·`]]`·`.md`·`wiki/…/` 제거. Zod `preprocess/transform/union` 사용 금지 ✅ 2026-09-09 — tools.ts normalizeTerms(문자열→공백 분할)·normalizeSlug(`[[ ]]`·`|`·`#`·`.md`·`wiki/…/` 제거)·normalizeInt(문자열 정수 허용, `1.5` 거부). 스키마에는 union/preprocess 없음(실측 tools/list 금지 키워드 0)
- [x] P2-12 스키마 부분집합 검사 스크립트 `test/schema-subset.test.ts` — `tools/list` 덤프에서 금지 키워드(`anyOf|oneOf|allOf|\$ref|\$defs|const|default|additionalProperties|format`) 0건 ✅ 2026-09-09 — test/unit/p2-12-13-14-schema-names-descriptions.test.ts: tools/list 금지 키워드 0, 모든 스키마 키 ⊂ {type,properties,required,items,enum,description,minimum,maximum,minItems,maxItems,minLength,maxLength}, type ⊂ {object,array,string,integer,number,boolean}
- [x] P2-13 도구명 `^[a-z][a-z0-9_]{0,63}$` 검사 ✅ 2026-09-09 — 동일 파일: 이름 4개 정확·`^[a-z][a-z0-9_]{0,63}$`
- [x] P2-14 description — 영문 먼저 + 한국어 한 줄, 각 ≤500자, 합계 ≤2,000자, **마지막 줄에 그 도구의 라우팅 위치 한 줄**. 길이 테스트 추가 ✅ 2026-09-09 — 동일 파일: 각 ≤500(489/477/498/488), 합 1,952, 영문 첫 줄·한국어 줄·마지막 줄 `Routing:`, instructions 3줄(read-only·stale·superseded_by)
- [x] P2-15 stdout 순수성 테스트 — 서버 기동 후 첫 바이트가 `{` (JSON-RPC) 인지, `console.log` ESLint 위반 0건 ✅ 2026-09-09 — test/unit/p2-15-27-03-cli.test.ts: 실제 stdio 기동 후 stdout 첫 바이트 `{`·모든 줄 JSON, `LLMWIKI_DEBUG=1` 은 stderr `[llmwiki] <tool> <ms>` 만. ESLint no-console 0
- [x] P2-16 `structuredContent` 미지원 클라이언트 경로 — `content[0].text` 만으로 의미 완결 확인(수동: Inspector 에서 text 만 보고 답 가능) ✅ 2026-09-09 — 4도구 모두 `content[0].text` 가 1차 표현: search/expand/pack 은 Python 스크립트와 동일한 사람 가독 텍스트(tier·refs/score·slug·type / claims·conf·status 헤더), read_page 는 frontmatter 포함 전문. JSON 없이도 라우팅·인용 가능함을 인프로세스 시나리오(expand rerank 11 → pack)로 확인

### D. 보안·격리 (§5)
- [x] P2-17 `walkMd` — 심볼릭 링크 엔트리(파일·디렉터리) 스킵 + 각 `.md` `realpath` 가 `<root>/wiki/` 하위인지 `path.relative` 판정(`..` 시작·절대경로면 제외), 제외 시 stderr 경고 1줄(내용 금지) ✅ 2026-09-09 — vault.ts walkMd: Dirent symlink 스킵 + 각 .md `realpath` 를 `path.relative(baseReal,…)` 로 경계 판정, 제외 시 stderr 경로만 경고
- [x] P2-18 `wiki_read_page` — 대상 파일 `realpath` 동일 판정 ✅ 2026-09-09 — read.ts isInside(wikiReal, file) 동일 판정, 실패 시 page not found 로 취급
- [x] P2-19 `--root` 자체 `realpath` 정규화 ✅ 2026-09-09 — cli.ts resolveRoot 가 `fs.realpath(root)` 결과를 서버에 전달
- [x] P2-20 쓰기 API 0개 — CI grep `writeFile|appendFile|unlink|rename|mkdir|rm(Sync)?\(` in `src/` → 0건 ✅ 2026-09-09 — ci.yml `Read-only guard` 스텝(grep 정규식, `truncated` 식별자 오탐 수정 후 양성·음성 대조 확인) + 로컬 실행 OK
- [x] P2-21 **심볼릭 링크 유출 테스트**(PRD §6) — 임시 볼트에 `wiki/leak.md → 외부 파일`, `wiki/leakdir → 외부 디렉터리` 를 만들고 `wiki_search`·`wiki_expand`·`wiki_pack`·`wiki_read_page` 전부 내용 미노출 확인(테스트 코드는 픽스처 밖 tmp 에 링크 생성, Windows 는 권한 없으면 skip 표기) ✅ 2026-09-09 — test/unit/p2-21-symlink-leak.test.ts: 파일·디렉터리 symlink 볼트에서 4도구 모두 비밀 토큰 미노출, read_page 는 page not found(권한 없으면 사유 skip)
- [x] P2-22 경로 탈출 테스트 — `../CLAUDE.local.md`, `wiki2/x`, 대소문자 변형, URL 인코딩 → 전부 거부 ✅ 2026-09-09 — test/unit/p2-22-path-escape.test.ts(37건): `../`, `wiki2/x`, `a\\b`, `..`, `%2e%2e/x`, `%2e%2e%2fx`, 빈 값, 대소문자 변형(alias 로 해석되며 path 는 `wiki/` 하위·`..` 없음)
- [x] P2-23 입력 상한 테스트 — terms 11개, 65자 term, slugs 31개, 200KB 초과 페이지 ✅ 2026-09-09 — test/unit/p2-11-23-input-normalization-limits.test.ts(28건): terms 11·65자·slugs 31·slug 121자 거부, 250KB 페이지 read_page/pack truncated:true + 마커

### E. CLI 서브커맨드 `src/cli.ts`, `src/print-config.ts`
- [x] P2-24 `--selftest` — 페이지 수·MoC 수·buildGraph(ms)·프로세스 기동→ready(ms) 출력 후 종료 ✅ 2026-09-09 — cli.ts `--selftest`: pages·mocs·buildGraph_ms·startup_to_ready_ms 출력(픽스처 26·3)
- [x] P2-25 `print-config --client <claude-code|codex|gemini|agy|cursor|windsurf|claude-desktop|vscode> --root <r> [--windows] [--global]` — §8 매트릭스와 동일한 명령/JSON/TOML 출력, **파일 쓰기 없음**, 경로 인용 처리(공백·한글) ✅ 2026-09-09 — print-config.ts 8 클라이언트(§8 실측 문법), `--windows`(cmd /c 래핑)·`--global`(llmwiki-mcp 직접)·`--name`, 셸 인용(공백·한글), **파일 쓰기 없음**
- [x] P2-26 `print-config` 스냅샷 테스트 8종 × (기본/--windows/--global) ✅ 2026-09-09 — test/unit/p2-26-print-config-snapshots.test.ts: 8종 × 기본/--windows/--global 24 스냅샷 리터럴 + 구조 검사(cmd /c, llmwiki-mcp 직접, 셸 인용, JSON 파싱, vscode `servers`, env.LLMWIKI_ROOT)
- [x] P2-27 `--version`, `--help` ✅ 2026-09-09 — cli.ts `--version`, `--help`(모든 서브커맨드·env 설명)

### F. 성능 (§6)
- [x] P2-28 파일 read `fs.promises.readFile` 동시성 32, 정렬 목록 기준 재조립(순서 불변) ✅ 2026-09-09 — vault.ts readAll: fs.promises.readFile, 워커 32, 인덱스 슬롯에 기록해 정렬 순서 불변(에이전트 코드 검토 vault.ts 254–268)
- [x] P2-29 실볼트 `--selftest` 측정 — buildGraph <1s @ ≈315 페이지, 기동→ready <2s (npx 캐시 후). 결과 `todo/baseline/P2-perf.txt` ✅ 2026-09-09 — baseline/P2-perf.txt(로컬, 숫자만): 실볼트 309p/18moc buildGraph median 31–37ms, startup→ready 33–38ms, 프로세스 wall 146–175ms (n=5×2)
- [x] P2-30 1,000 페이지 합성 볼트 생성 스크립트로 <3s 확인 ✅ 2026-09-09 — test/perf/make-synthetic-vault.py(결정적, 합성어만)+bench.py: 합성 300p buildGraph 31ms·expand+rerank wall 200ms / 1,000p buildGraph 85–88ms·expand wall 382–421ms — 목표(<1s@300, <3s@1000) 충족. 분해: walkMd realpath 순차 await ~30ms@1000 → 디렉터리 단위 병렬로 수정(순서 불변, 패리티 재확인)

### G. 검증
- [x] P2-31 MCP Inspector 로 `tools/list` 4개 · 스키마 · description · instructions 확인(스크린샷 `todo/evidence/P2-inspector.png`) ✅ 2026-09-09 — MCP Inspector **CLI**(`--config`+`--server`, 인라인 명령은 Inspector 파서가 `--root` 를 삼킴)로 실 stdio 검증: tools/list 4개, 스키마 키 `[properties, required, type]` 만, description 477–498자. instructions 는 SDK Client 로 별도 캡처. 증거 evidence/P2-inspector-*.json(로컬) + review/P2-tools-list.json(커밋). ⏸ 스크린샷(png) 대신 JSON 캡처 — 브라우저 미사용
- [x] P2-32 Inspector 에서 사실브리핑 시나리오 수동 실행 — `wiki_expand(rerank=11)` → `suggested_next=wiki_pack` → `wiki_pack` 텍스트 확인 ✅ 2026-09-09 — Inspector CLI 시나리오: wiki_expand(벡터·인덱스, max 20, rerank 11) → 11행·suggested_next=wiki_pack → wiki_pack 상위 5 → claims 14줄·`[type · conf X · status]` 헤더, isError 없음. evidence/P2-scenario-pack.txt
- [x] P2-33 `--once` 와 MCP 도구 출력 텍스트 동일성 테스트(같은 코드 경로 증명) ✅ 2026-09-09 — test/unit/p2-33-once-vs-mcp.test.ts: 14질의×4모드 `callTool().content[0].text === runOnce()` 56건. 계약 명시: **절단(200KB) 전 리트리벌 텍스트가 동일** — `--once` 는 Python 패리티 도구라 capText 를 적용하지 않는다(codex 2차 #5)
- [x] P2-34 패리티 CI 재실행 녹색(P1 회귀 없음) ✅ 2026-09-09 — PR #21: parity·smoke × ubuntu/macos/windows **6/6 pass**. parity 잡은 `npm run check`(480 tests)+`parity.py`+읽기전용 가드+pack 가드를 포함

### 추가 항목 (P2 진행 중 발견)
- [x] P2-35+ (테스트 검출) `normalizeSlug` 의 문자 클래스 `^[\p{L}\p{N}._\- ]+$` 가 wiki_expand 가 돌려주는 기호 포함 slug(`zz-🦀-crab`)를 wiki_pack 에서 거부 → 라우팅 흐름 단절·`--once`≠MCP. "위험 문자만 금지"(`/`·`\`·`..`·`\p{Cc}`)로 변경, DESIGN §3.4 개정 ✅ 2026-09-09
- [x] P2-36+ (테스트 검출) `wiki/../x` 가 `..` 검사 전에 접두 제거되어 `x` 로 재해석 → `.`/`..` 세그먼트가 있으면 접두 제거 안 함 → 거부 ✅ 2026-09-09
- [x] P2-37+ URL 인코딩 경로 문자(`%2e`·`%2f`·`%5c`)는 디코드하지 않지만 검증 오류로 명시 거부(조회 실패로 가장하지 않음) ✅ 2026-09-09
- [x] P2-38+ (perf 측정 반영) walkMd realpath 경계 검사를 디렉터리 단위 `Promise.all` 로 병렬화(순서 불변) — synth1000 buildGraph 85→50ms ✅ 2026-09-09
- [x] P2-39+ 런타임 의존 zod 제거(sdk 하나) — 수기 JSON Schema 채택에 따른 결과, scaffold 테스트·DESIGN §2 갱신 ✅ 2026-09-09
- [x] P2-40+ `--selftest` 의 `pages` 는 고유 slug 수(그래프 노드) — 픽스처 26파일이지만 dup-note 중복으로 25. 테스트에 주석 고정 ✅ 2026-09-09
- [x] P2-42+ (codex BLOCKER-2 TOCTOU) `read()` 를 `fs.open(O_RDONLY|O_NOFOLLOW)`+`fh.readFile` 로 — realpath 검사 후 링크로 바뀐 최종 구성요소를 따라가지 않음(POSIX). 잔여 위험(상위 디렉터리 교체 경쟁)은 로컬 단일 사용자 도구 범위에서 수용, DESIGN §5 기재 ✅ 2026-09-09
- [x] P2-43+ (codex BLOCKER-3) structuredContent 상한 우회 — `capPages()` 로 pack pages 도 같은 UTF-8 바이트 예산(페이지→claims/relations 줄 단위 절단), truncated 통합 ✅ 2026-09-09
- [x] P2-44+ (codex MAJOR-1·agy MAJOR-2) outputSchema 런타임 검증 — `validateSubset()`(우리 부분집합 키워드만) 을 callTool 응답 직전에 적용, 불일치는 요청 실패(fail-closed) ✅ 2026-09-09
- [x] P2-45+ (codex MAJOR-2) 자원 상한 — MAX_FILE_BYTES 16MiB·MAX_FILES 20,000 초과 시 결과를 바꾸지 않고 `VaultLimitError`(isError; --once 는 exit 1), 동시 도구 호출 세마포어 4 ✅ 2026-09-09
- [x] P2-46+ (codex MAJOR-3) Windows `cmd /c` 메타문자 — `--windows` 에서는 볼트 경로를 명령 인자에 절대 넣지 않음: JSON 형은 env.LLMWIKI_ROOT, CLI 형은 `--env`/`-e`, codex TOML 은 env 테이블 ✅ 2026-09-09
- [x] P2-47+ (codex MAJOR-4) `--name` 주입 — SERVER_NAME_RE `^[A-Za-z][A-Za-z0-9_-]{0,63}$` 검증, root 의 개행·NUL 거부 ✅ 2026-09-09
- [x] P2-48+ (codex MAJOR-5·agy MINOR-4) 읽기 전용 가드를 블랙리스트 정규식에서 **허용목록**(fs/fh 멤버 ⊂ readFile·readdir·stat·realpath·open·close·constants·promises·readFileSync, 대괄호 접근 금지, open 쓰기 플래그 금지)으로 ✅ 2026-09-09
- [x] P2-49+ (codex MAJOR-6·7) 로그 — debug `ready` 에서 root 경로 제거, 경계 위반 경고는 `JSON.stringify(상대경로)` 로 개행 주입 방지. `--selftest` 의 root 표시는 유지(사용자 본인 진단 출력; 리뷰 제안 중 이 부분은 기각) ✅ 2026-09-09
- [x] P2-50+ (codex MINOR-1·agy MAJOR-3) 200KB 를 UTF-8 **바이트** 기준으로, 코드포인트 경계 보존(lone surrogate 방지) ✅ 2026-09-09
- [x] P2-51+ (codex MINOR-3) `normalizeSlugs` 비문자 항목 즉시 거부 ✅ 2026-09-09
- [x] P2-52+ (codex MINOR-4) 도구별 마지막 라우팅 줄을 실제 호출 위치로(search=fallback, expand=FIRST+표, pack=after rerank 11, read=after max 8). description 350/491/383/377 ✅ 2026-09-09
- [x] P2-53+ (agy MAJOR-1) `--root` 가 `--once` 앞에 와도 유실되지 않음(argv 전체 전달); (agy MINOR-5) `print-config` 위치 무관 ✅ 2026-09-09
- [x] P2-54+ (agy MINOR-8) read_page 의 이중 walk 제거 — buildGraph(base, files) 재사용 ✅ 2026-09-09
- [x] P2-55+ (codex 2차 BLOCKER-1) `root/wiki` 자체가 심볼릭 링크면 walkMd 경계(`realpath(wiki)` 하위)가 외부를 내부로 승인 → `src/root.ts` resolveRoot: wiki 는 `lstat` 비링크 디렉터리, `realpath(wiki)` 가 정확히 `<rootReal>/wiki` 여야 함. 서버·selftest·`--once` 가 같은 함수 사용(codex 2차 #5) ✅ 2026-09-09
- [x] P2-56+ (codex 2차 #3) 원시 입력 크기 가드(문자열 4,096자·배열 256항목, 분할·순회 전) + 볼트 디렉터리 5,000·깊이 32·누적 512MiB 상한 ✅ 2026-09-09
- [x] P2-57+ (codex 2차 #4) 절단 마커를 예산에 포함 — 응답 텍스트 전체 ≤ 200KB ✅ 2026-09-09
- [x] P2-58+ (codex 2차 #6) Windows CLI 형은 cmd.exe 인용(`cmdq`: `%`→`%%`, `"` 이스케이프) + PowerShell·지연확장 주의 주석 ✅ 2026-09-09
- [x] P2-59+ (codex 2차 #7·agy 2차 MAJOR-1) 읽기 전용 가드에 import 구문 검사 추가 — named import 허용목록·네임스페이스/default/require/동적 import 금지·`promises` 별칭 추적. 양성 대조 통과 ✅ 2026-09-09
- [x] P2-60+ (codex 2차 #8·agy 2차 MAJOR-3) validateSubset: 선언된 properties 밖 키 거부(strict), 명시적 `undefined` 는 생략 ✅ 2026-09-09
- [x] P2-61+ (codex 2차 #10) `--selftest` root 는 basename+sha256[:8], 전체 경로는 `--show-root`; 오류 메시지는 입력 문자열만 반영 ✅ 2026-09-09
- [x] P2-62+ (agy 2차 MAJOR-2) 세마포어 슬롯 인계(release 가 대기자에게 직접 인계) — 큐 추월·초과 진입 불가, `concurrencyState()` 관측 ✅ 2026-09-09
- [x] P2-63+ (agy 2차 MINOR-4) `print-config` 가 `--once` 보다 우선, 값 옵션 뒤 토큰은 플래그로 오인하지 않음 ✅ 2026-09-09
- [x] P2-64+ (3차) `%%` 는 **배치 파일 전용 이스케이프** — 대화형 cmd.exe 는 큰따옴표 안에서도 `%VAR%` 를 확장한다. 따라서 `%`·`!` 가 든 root 는 Windows **CLI 형 등록을 거부**(PrintConfigError, JSON 설정형 안내)하고, `cmdq` 는 인용만 한다. WIN_NOTE 문구도 정정 ✅ 2026-09-09
- [x] P2-65+ (3차) `cmdq` 안전 문자에 `/` 추가 — `cmd "/c"` → `cmd /c`(TOML·JSON args 표기와 일치) ✅ 2026-09-09
- [x] P2-66+ (3차) `validateSubset`: required 키가 **명시적 undefined** 여도 누락으로 판정(JSON 직렬화에서 사라지므로) ✅ 2026-09-09
- [x] P2-67+ 단위 테스트 최종 **31파일 455건** 통과(P2 신규 279). parity·fuzz·smoke 회귀 없음 ✅ 2026-09-09
- [x] P2-68+ (codex 3차 BLOCKER-1) 읽기 전용 가드가 `import { open as create }` 별칭 쓰기를 놓침 → import 로컬 바인딩 추적(별칭 호출의 쓰기 플래그 검사). 우회 5종 대조: named import·네임스페이스·promises 별칭 멤버·open 별칭 쓰기 = 전부 차단, 읽기 전용 open 은 통과 ✅ 2026-09-09
- [x] P2-69+ (codex 3차 MAJOR-3) `pack()` 누적 원문 예산 32MiB — 초과 시 **다음 페이지를 읽지 않고** VaultLimitError(30×16MiB 누적 방지) ✅ 2026-09-09
- [x] P2-70+ (codex 3차 MAJOR-4) 응답 **envelope 전체** 200KB 예산 — text·pages 를 각각 잘라도 합이 넘던 문제. 초과 시 text 를 절반 예산으로 줄이고 pack 은 pages 비움 ✅ 2026-09-09
- [x] P2-71+ (codex 3차 MAJOR-5) `structuredContent` 미지원 클라이언트에서 라우팅 정보 유실 → MCP `wiki_expand` **텍스트 마지막 줄에 `suggested_next: …`** 추가. `--once` 는 Python 패리티 유지(추가 안 함) ✅ 2026-09-09
- [x] P2-72+ (codex 3차 MINOR-7) POSIX 인용을 큰따옴표 → **작은따옴표**(`'\''` 분해)로 — `$`·백틱·`!`(history expansion) 완전 차단 ✅ 2026-09-09
- [x] P2-73+ (codex 3차 MINOR-8) 체크리스트 문구 정정 — `cmdq` 는 `%%` 이스케이프가 아니라 **`%`·`!` 경로의 CLI 형 거부**(P2-64+ 참조) ✅ 2026-09-09
- [x] P2-74+ (3차 테스트 검토 잔여 결함) `wiki_read_page` frontmatter 스칼라가 무제한 → envelope 409,776B. 필드별 `FIELD_LIMIT`(4KiB) 절단 + envelope **재측정 루프**(절반→1/4…, 6회 후에도 초과면 isError). 실측 409,776 → 106,655B ✅ 2026-09-09
- [x] P2-75+ 단위 테스트 최종 **36파일 480건** 통과(P2 신규 304). parity 56·실볼트 20(digest 동일)·퍼징·smoke 회귀 없음 ✅ 2026-09-09
- [x] P2-41+ (중간 집계) 단위 테스트 **30파일 421건**(P2 신규 245 — 1차 리뷰 반영 테스트 56건 포함: 바이트 절단·capPages·validateSubset·이름 주입·Windows env 전용·동시 12호출·17MiB·20,001파일·O_NOFOLLOW·로그 주입 실증) 통과, parity·fuzz·smoke 회귀 없음 ✅ 2026-09-09

## 산출물
- `src/server.ts`, `src/read.ts`, `src/print-config.ts`, `src/cli.ts`, 테스트(스키마 부분집합·보안·스냅샷·stdout)
- `todo/baseline/P2-perf.txt`, `todo/evidence/P2-inspector.png`

## 완료 기준 (DoD)
- [x] A~G 전 항목 완료 또는 사유 명시 ✅ 2026-09-09 — CI 3-OS 6/6 확인 후 체크. P2-31 은 브라우저 대신 Inspector CLI JSON 캡처(사유 명시)
- [x] 보안 테스트(P2-21~23) 전건 통과, 쓰기 API grep 0건 ✅ 2026-09-09
- [x] 스키마 부분집합·도구명·description 길이·stdout 순수성 테스트 통과 ✅ 2026-09-09
- [x] Inspector 확인 증거 보관 ✅ 2026-09-09 — evidence/P2-inspector-*.json(로컬)·review/P2-tools-list.json(커밋)
- [x] 외부리뷰 완료 ✅ 2026-09-09 — 3라운드(codex 1·2·3차, agy 1·2차) 지적 40여 건 전건 판정. 잔여 BLOCKER 0(3차 BLOCKER 2건: 가드 별칭 우회→P2-68+, CI 증거→본 항목). 이월 5건 P3-26+~30+

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/server.ts`, `read.ts`, `print-config.ts`, `cli.ts`, 보안 테스트, `tools/list` 덤프(JSON)
- 관점: ① 위협 모델 — 경로 탈출·심볼릭 링크·입력 상한·로그 유출에 남은 구멍 ② 도구 description·instructions 가 라우팅을 유도하기에 충분한가, 토큰 과다는 아닌가 ③ 스키마가 Gemini·Codex·Cursor 에서 거부될 요소가 남았는가 ④ `print-config` 출력이 각 클라이언트 실제 문법과 맞는가(§8 실측 기준) ⑤ `structuredContent`/`outputSchema` 사용이 SDK 계약에 맞는가
- 절차: `00-README.md` 규칙. 프롬프트 `review/P2-prompt.txt`, 결과 `review/P2-agy-YYYY-MM-DD.md` + `codex` 교차 리뷰 권장(보안 단계)

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| 1차 codex 2026-09-09 (`review/P2-codex-2026-09-09.md`, BLOCKER 3·MAJOR 8·MINOR 4) · 1차 agy (`review/P2-agy-2026-09-09.md`, MAJOR 3·MINOR 5) | | | | |
| c-B1 | BLOCKER | DoD 가 P2-34(CI) 전 체크; 리뷰어 샌드박스 vitest EPERM | 수용(절차) — DoD "A~G" 는 CI 후 최종 확인 | P2-34 |
| c-B2 | BLOCKER | realpath 검사↔read 사이 TOCTOU | 수용(완화) O_NOFOLLOW, 잔여 위험 문서화 | P2-42+ |
| c-B3 | BLOCKER | pack structuredContent 가 200KB 우회 | 수용 | P2-43+ |
| c-M1 / a-M2 | MAJOR | 저수준 Server 로 output 검증 상실 | 수용 — 런타임 부분집합 검증 fail-closed | P2-44+ |
| c-M2 | MAJOR | 파일 크기·수·동시성 상한 부재 | 수용 — 명시적 오류(결과 불변) + 세마포어 | P2-45+ |
| c-M3 | MAJOR | Windows cmd /c 메타문자 | 수용 — 경로는 env 로만 | P2-46+ |
| c-M4 | MAJOR | `--name` 셸/TOML 주입 | 수용 | P2-47+ |
| c-M5 / a-m4 | MAJOR | grep 블랙리스트 가드 우회 | 수용 — 허용목록 | P2-48+ |
| c-M6 | MAJOR | stderr/selftest 경로 노출 | 부분 수용 — debug 로그 제거, selftest 는 유지(근거: 사용자 진단) | P2-49+ |
| c-M7 | MAJOR | 경고 로그 파일명 주입 | 수용 | P2-49+ |
| c-M8 | MAJOR | 다중 클라이언트 실제 검증 없음 | **기각(범위)** — P3-11~17 클라이언트 매트릭스 실측이 그 단계 | P3 |
| c-M9 | MAJOR | 테스트가 Windows skip·TOCTOU·CMD 메타문자 미검증 | 부분 수용 — CMD 메타문자·비문자·바이트 절단 등 테스트 추가; TOCTOU 경쟁 테스트는 비결정적이라 미도입 | 테스트 갱신 |
| c-m1 / a-M3 | MINOR/MAJOR | 200KB 가 UTF-16 길이·서로게이트 파손 | 수용 | P2-50+ |
| c-m2 / a-m7 | MINOR | NFC/NFD 미정규화 | **기각** — Python 정본 패리티. P3 README 한계에 명시(P3-01 에 이미 포함) | P3-01 |
| c-m3 | MINOR | normalizeSlugs 비문자 무음 삭제 | 수용 | P2-51+ |
| c-m4 | MINOR | 동일 라우팅 줄 반복 | 수용 | P2-52+ |
| a-M1 | MAJOR | `--root` 가 `--once` 앞이면 유실 | 수용 | P2-53+ |
| a-m5 | MINOR | print-config 선두 고정 | 수용 | P2-53+ |
| a-m6 | MINOR | 바이트 vs 문자 상한 | 수용 | P2-50+ |
| a-m8 | MINOR | read_page 이중 walk | 수용 | P2-54+ |
| 2차 codex (`review/P2-codex-r2-2026-09-09.md`, BLOCKER 2·MAJOR 6·MINOR 2) · 2차 agy (`review/P2-agy-r2-2026-09-09.md`, MAJOR 3·MINOR 2) — 1차 반영 판정: agy 전건 동의(가드 1건 이의), codex 부분 동의 | | | | |
| c2-B1 | BLOCKER | `root/wiki` 심볼릭 링크로 외부 유출 | **수용** — 실제 결함 | P2-55+ |
| c2-B2 | BLOCKER | 테스트·DoD 가 샌드박스에서 미검증 | 수용(절차) — CI 녹색까지 DoD "A~G" 미체크 | P2-34 |
| c2-3 | MAJOR | 요청 전체 크기·누적 메모리 상한 부재 | 수용 | P2-56+ |
| c2-4 | MAJOR | 마커가 200KB 초과 | 수용 | P2-57+ |
| c2-5 | MAJOR | `--once` 가 다른 root 경로·상한 없음 | 수용(root 공유) / capText 미적용은 **의도** — `--once` 는 Python 패리티 도구, P2-33 계약은 "절단 전 리트리벌 텍스트 동일" 로 명시 | P2-55+, P2-33 문구 |
| c2-6 | MAJOR | Windows env 값의 `%`·`!` | 수용(cmdq `%%` + 주석) — 실제 Windows 셸 실행 검증은 P3 매트릭스 | P2-58+ |
| c2-7 / a2-M1 | MAJOR | 가드가 named import 를 놓침 | 수용 | P2-59+ |
| c2-8 | MAJOR | 검증기가 unknown 키 무시·독립 검증 부재 | 부분 수용 — strict 로 변경; 독립 validator(ajv) 도입은 devDependency 추가라 P3 로 이월 | P2-60+, P3 |
| c2-9 | MINOR | NFC/대소문자·UNC 케이스 | 기각(패리티) — P3 README 한계 | P3-01 |
| c2-10 | MINOR | selftest·오류의 절대 경로 | 수용 | P2-61+ |
| a2-M2 | MAJOR | 세마포어 큐 추월 | 수용 | P2-62+ |
| a2-M3 | MAJOR | validateSubset 의 명시적 undefined 오탐 | 수용 | P2-60+ |
| a2-m4 | MINOR | `--once` 우선순위·플래그 필터 부작용 | 수용 | P2-63+ |
| a2-m5 | MINOR | 스키마↔TS 타입 정적 연결 부재 | 이월(P3) — 런타임 strict 검증으로 대체, 타입 생성은 후속 | P3 |
| 3차 codex (`review/P2-codex-r3-2026-09-09.md`, BLOCKER 2·MAJOR 4·MINOR 2) — 2차 반영 검증: root/wiki 차단·공유 resolver 반영 확인 | | | | |
| c3-B1 | BLOCKER | 가드가 `open` 별칭 쓰기를 놓침 | **수용** | P2-68+ |
| c3-B2 | BLOCKER | P2-34·DoD·외부리뷰 미완료 | 수용(절차) — CI 후 체크 | P2-34 |
| c3-3 | MAJOR | pack 이 30×16MiB 를 다 읽고 자름 | 수용 | P2-69+ |
| c3-4 | MAJOR | text·pages 각각 200KB → 합 400KB | 수용 | P2-70+ |
| c3-5 | MAJOR | text-only 클라이언트에 라우팅 정보 없음 | 수용 | P2-71+ |
| c3-6 | MAJOR | symlink 테스트가 skip 시 통과로 집계 | 수용(테스트) — `it.skipIf` 로 전환 | 테스트 갱신 |
| c3-7 | MINOR | POSIX `!` 미이스케이프 | 수용 | P2-72+ |
| c3-8 | MINOR | 체크리스트 `%%` 문구 | 수용 | P2-73+ |
| c3-추가 | (테스트 검토) | read_page frontmatter 무제한 → envelope 초과 | 수용 | P2-74+ |


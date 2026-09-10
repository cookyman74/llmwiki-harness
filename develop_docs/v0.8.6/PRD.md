# PRD — llmwiki MCP 서버 (Node.js 포팅)

- **버전 대상**: 하네스 다음 minor. ※문서 폴더명은 v0.8.6이나 최신 릴리즈 태그는 **v0.10.0** → 실제 배포 태그는 **v0.11.0** 후보(외부 인터페이스 신설이라 minor). npm 패키지는 별도 버전 `0.1.0`부터.
- **작성일**: 2026-09-07
- **범위**: `tools/llmwiki-mcp/` (신설, TypeScript) · 리트리벌 알고리즘 포팅(search.py `--files` + scope-expand.py expand/pack/rerank) · MCP stdio 서버 · npm 배포 · 사용자 레벨 안내 스킬 · CI 패리티 테스트
- **비대상**: 쓰기 도구(파일링·인제스트·lint) · HTTP/SSE 트랜스포트 · 임베딩/시맨틱 검색 · Python 스크립트 폐기(볼트 내부 하네스는 계속 Python)

## 1. 배경 / 문제

위키 질의 능력이 **이 볼트 디렉터리에서 실행한 Claude Code에만** 갇혀 있다.

| 현상 | 원인 |
|---|---|
| 다른 프로젝트에서 작업 중인 Claude Code가 위키를 못 본다 | `wiki-query`·`wiki-ops`가 프로젝트 스킬(`.claude/skills/`) — 볼트 밖에서는 로딩 안 됨 |
| Codex·Cursor·Claude Desktop·직접 만드는 LangGraph 에이전트가 위키를 못 쓴다 | 노출 인터페이스가 없음. 스킬은 Claude Code 전용 개념 |
| 리트리벌 규칙(라우팅·rerank 11·팩)을 클라이언트마다 재발견한다 | 규칙이 SKILL.md 산문에만 있고 도구 계약에 없음 |

반면 리트리벌 자체는 이미 **결정적·0토큰**이다. `search.py --files`(lexical seed) → `scope-expand.py expand`(관계 1홉 + MoC 소프트 Top-K) → `--rerank`(BM25) → `pack`(claims·confidence·status·관계). 합쳐 446줄, 표준 라이브러리만 사용, `--root`로 볼트 경로를 받는다. 즉 새로 만들 것은 "지식"이 아니라 **이 4단계를 노출하는 껍데기**다.

2026-09-07에 하네스(공개 `llmwiki-harness`)와 볼트(비공개 `llmwiki-vault`)를 저장소 둘로 분리했다. MCP 서버는 하네스 저장소에서 개발·배포하고, 볼트는 `--root`로 지정되는 데이터일 뿐이다.

### 대상 클라이언트 (1급 요구 — 2026-09-09 재검토)

"다른 에이전트"는 Claude Code 하나가 아니다. 아래 전부가 **등록 1줄로 설치되고, 클라이언트 측 규칙 파일 없이** 라우팅 규약을 지키며 동작해야 한다. 설치 방법이 클라이언트마다 다르다는 것을 로컬 실측으로 확인했다.

| 클라이언트 | 등록 방식(실측) | 비고 |
|---|---|---|
| Claude Code | `claude mcp add --scope user …` | 스킬·instructions 모두 인식 |
| Codex CLI (0.153) | `codex mcp add <name> -- <cmd…>` 또는 `~/.codex/config.toml` `[mcp_servers.<name>]` | **stdio 기동 타임아웃 기본 10s** — 사용자 config에 이미 `startup_timeout_sec = 120`을 올린 서버가 있음(npx 콜드스타트 실증) |
| Gemini CLI | `~/.gemini/settings.json` `mcpServers` / `gemini mcp add` | JSON Schema **부분집합**만 수용(anyOf·$ref 등 취약) |
| agy | `agy mcp add [flags] <name> -- <cmd> [args…]` | 플래그는 name 앞, `-`로 시작하는 인자 앞에 `--` 필요 |
| Cursor · Windsurf · Claude Desktop | `mcp.json` / `mcp_config.json` / `claude_desktop_config.json`의 `mcpServers` | `env` 블록 지원 → `LLMWIKI_ROOT` |
| VS Code (Copilot) | `.vscode/mcp.json` — 키가 `servers`(다름) | |
| 자체 에이전트(LangGraph 등) | MCP 클라이언트 SDK(TS/Python) stdio | `langchain-mcp-adapters` 등 |
| Windows 전 클라이언트 | JSON 설정형은 `cmd /c npx …` 래핑 필요 | 흔한 실패 원인 |

이 표가 곧 인수 테스트 매트릭스다(§6).

### 왜 Node.js인가 (FastMCP/Python 대신)

- MCP 공식 SDK(`@modelcontextprotocol/sdk`)가 TypeScript 우선. 문서·예제 최다.
- 배포·등록이 한 줄: `npx -y llmwiki-mcp --root <볼트>`. Claude Code(`claude mcp add`)·Codex(`config.toml`)·Claude Desktop·Cursor 설정에 그대로 복사 가능.
- 사용자 주력 스택이 node.js/typescript.
- 대안 A(Node가 python3를 자식 프로세스로 호출)는 "npx만으로 끝"이라는 배포 동기를 절반만 채움 → **순수 TS 포팅(대안 B)** 채택. 구현 2벌의 드리프트는 **패리티 테스트**로 막는다(§5).

> **외부리뷰(agy, 2026-09-09) 반론.** 리트리벌 규칙은 고정 표준이 아니라 튜닝되는 휴리스틱이다(2026-08-01 하루에 3번 바뀜). 구현 2벌 + "3점 동시 수정" 규약은 영구 부채다. 배포 동기만 보면 **FastMCP(Python) 1벌 + `uvx llmwiki-mcp --root …`** 가 npx와 동등한 한 줄 경험을 주며 중복이 0이다.
>
> **재검토 결론(2026-09-09, 다중 클라이언트 관점) — Node 확정.** 결정적 근거는 런타임 보장이다. **Codex CLI·Gemini CLI·Claude Code는 모두 npm 패키지**라 대상 머신에 Node가 반드시 있다. Cursor·Windsurf·VS Code도 Node 내장. 반면 Python 3 + `uv`는 어느 클라이언트도 보장하지 않는다 — "손쉽게 설치"의 병목은 서버 코드 줄 수가 아니라 **사전 설치물 0개**다. 따라서 대안 B(TS 포팅) 유지. 2벌 부채는 패리티 CI로 봉인하고, 리트리벌 규칙 변경 빈도가 계속 높으면 v1.x에서 TS 단일 정본 수렴(설계서 §10 (b))을 재검토한다.

## 2. 목표 (What)

1. **① 리트리벌 포팅**: search/expand/rerank/pack을 TypeScript로 **바이트 동일 출력**으로 포팅한다. 랭킹 규칙(정렬 키·MEMBER_K=6·BM25 k1=1.5/b=0.75·tier 규칙)은 Python 원본이 정본이며 변경하지 않는다. 정본 Python에는 **결정성 확보 목적의 수정 1건만** 허용한다(디렉터리 순회 정렬·개행 고정 — 설계서 §7). 랭킹 결과에 영향 없음을 실 볼트로 확인한다.
2. **② MCP stdio 서버 — 자기서술(self-describing)**: 읽기 전용 도구 4개를 노출한다 — `wiki_search`, `wiki_expand`, `wiki_pack`, `wiki_read_page`. 라우팅 규약(단일조회=seed·사실=rerank11+팩·절차=full-read)과 신뢰도 병기·stale 회피 규약을 **서버 안에 3중으로** 심는다: 서버 `instructions` + 각 도구 description 한 줄 + `wiki_expand` 출력의 `suggested_next`. 클라이언트가 `instructions`를 모델에 안 보여줘도(Codex·Gemini 미확인) 나머지 둘로 동작해야 한다. **클라이언트 측 규칙 파일은 선택사항**이다.
3. **③ 배포 — 사전 설치물 0개**: npm 공개 패키지 `llmwiki-mcp`(미등록 확인 2026-09-07). `npx -y llmwiki-mcp`가 유일한 실행 경로이며 Node 외 의존 없음. README에 **클라이언트 8종 등록 매트릭스**(§1 표) + Windows `cmd /c` + Codex 타임아웃 + `npm i -g` 대안 수록. `npx llmwiki-mcp print-config --client <이름> --root <볼트>`가 해당 클라이언트용 명령/JSON/TOML 스니펫을 **출력만** 한다(사용자 설정 파일에 쓰지 않음 — 그 파일들은 타 서버의 비밀키를 담고 있어 자동 편집이 위험).
4. **④ 클라이언트 규칙 스니펫(선택)**: 하나의 원본 `templates/mcp-client-guide.md`(라우팅 표 + 규약 3줄, 20줄 이내)에서 Claude Code 스킬·Codex `AGENTS.md`·Gemini `GEMINI.md`·Cursor rules 조각을 파생. 없어도 동작해야 하며(②), 있으면 라우팅 준수율을 올리는 보조 수단.
5. **⑤ 패리티 CI**: 합성 픽스처 볼트에 대해 Python·Node 출력을 diff. 불일치 시 CI 실패.

## 3. 성공 지표 (측정 가능)

| 지표 | 목표 | 측정 |
|---|---|---|
| Python↔Node 출력 패리티 | 픽스처 질의 **전건 바이트 동일**(expand 무rerank·pack·search --files). rerank 모드는 행 순서·slug·tier·type 정확 일치 + 점수 열 ±0.05(부동소수점 1 ULP 흡수) | `tests/parity.py` — 질의 12개 × 모드 4 |
| 실 볼트 패리티 | 실 볼트(≈315 페이지) 대표 질의 5개 동일 | `tests/parity.py --vault <경로>` — 로컬 1줄 자동(콘텐츠라 CI에선 스킵), 릴리즈 체크리스트 |
| 설치 → 첫 응답 | 클라이언트마다 **등록 1줄**, 사전 설치물 0개(Node 외), **5분 이내** | 클라이언트 매트릭스 시연 |
| 클라이언트 매트릭스 | Claude Code·Codex·Gemini CLI·agy·Cursor **5종 필수** + Claude Desktop·VS Code·Windows 중 1종 | 각각 등록→`wiki_expand` 1회→사실브리핑 답 1건 |
| 규칙 파일 없이 라우팅 준수 | 클라이언트 규칙 스니펫 **없는 상태**에서 사실브리핑 질의 3건 × 클라이언트 3종: `wiki_pack` 전 `wiki_read_page` 호출 **0회**, 팩 후 read_page ≤1 | 서버 stderr 도구 호출 로그(`LLMWIKI_DEBUG=1`) |
| 기동 시간 | npx 캐시 후 서버 ready **<2s**(Codex 기본 타임아웃 10s 안), 콜드스타트 <30s | `--selftest` 타이머 + Codex 실측 |
| 응답 지연 | 그래프 재구성 포함 **<1s** @ 300 페이지, <3s @ 1,000 페이지 | 서버 로그 타이머 |
| 쓰기 경로 | **0개** — 패키지 내 `fs.write*`·`unlink`·`rename` 호출 없음 | grep + 코드리뷰 |

## 4. 비목표 / 제약

- **쓰기 없음.** 파일링·인제스트·lint·MoC 갱신은 볼트 안 `wiki-ops` 전용. 외부 에이전트가 쓰면 `index.md`·`log.md` 정합이 깨진다. 향후 필요해도 별도 PRD.
- **Python 스크립트 유지.** 볼트 하네스(SessionStart 훅·lint·인제스트)는 계속 Python. Node 패키지는 **외부 노출 전용**. 두 구현의 정본은 Python.
- **캐시는 v1에서 안 함.** Python과 동일하게 호출마다 그래프 재구성(≈300 페이지 <1s). 서버는 장수 프로세스라 mtime 캐시가 이득이지만 패리티 검증 뒤 v1.1로 미룸(YAGNI).
- **임베딩·벡터 검색 없음.** lexical+그래프+BM25가 A/B 5라운드로 검증된 정본. 시맨틱은 별건.
- **원격 노출 없음.** stdio만. HTTP는 인증·볼트 격리 설계가 필요하므로 별건.
- **OneDrive 제약.** 볼트가 OneDrive 경로라 다른 머신에서 동기화 지연 시 최신 페이지가 안 보일 수 있음. 로컬 머신 단일 사용 전제.

## 5. 리스크 / 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| 구현 2벌 드리프트 — 랭킹 규칙을 한쪽만 고침 | 클라이언트마다 다른 답 | 패리티 CI 필수 게이트 + CLAUDE.md 규칙 "리트리벌 규칙 변경은 Python·TS·픽스처 3점 동시" |
| 정규식 의미 차이 — Python `\w`는 유니코드, JS `\w`는 ASCII | 한국어 관계 술어·aliases 오파싱 | 설계서 §4 대응표: `u` 플래그 + `[\p{L}\p{N}_-]`. 픽스처에 한국어·이모지·BOM 케이스 포함 |
| `str.count` vs JS — 부분문자열 비중첩 카운트 | tf·lexical 점수 불일치 | 전용 `countSub()` 헬퍼, 단위 테스트 |
| 정렬 안정성 — Python 튜플 정렬 vs JS 비교함수 | 동점 순서 뒤바뀜 | 비교함수를 튜플 키와 1:1로 작성, 마지막 키는 항상 slug |
| `os.walk` 순회 순서 vs `readdir` | `pack`에서 같은 slug 중복 시 어느 파일이 이기는지 | 디렉터리·파일 모두 정렬 후 순회, 중복 slug는 "마지막 승" 규칙을 양쪽 명시 |
| 경로 탈출 — `wiki_read_page("../CLAUDE.local.md")` | 볼트 밖 파일 노출 | slug 화이트리스트 정규식 + `wiki/` 하위 실경로 검증(`path.relative` 기반) |
| 심볼릭 링크 — `wiki/leak.md → ~/.ssh/…`가 그래프에 적재되어 search/pack으로 유출(외부리뷰 BLOCKER) | 볼트 밖 파일 노출 | `walkMd`가 심볼릭 링크 엔트리를 건너뛰고 각 파일 `realpath`를 `wiki/` 하위로 검증 |
| 입력 변형 — `terms`를 문자열로, slug에 `[[…]]`·`.md` 붙여 호출 | 검증 오류·빈 결과로 질의 중단 | 진입점 정규화(문자열→공백 분할, 대괄호·확장자 strip) |
| CRLF 파일 — Python은 universal newlines로 `\n` 변환, Node는 미변환 | dl·count 불일치 → BM25·lexical 랭킹 어긋남 | TS `read()`에서 `\r\n`·`\r`→`\n` 정규화(설계서 §4 #2) |
| npm 공개 패키지에 콘텐츠 유출 | 회사 정보 노출 | 패키지에는 코드·합성 픽스처만. `files` 필드 화이트리스트, `npm pack --dry-run`을 CI에서 검사 |
| 대형 볼트 지연 | 1,000+ 페이지에서 수 초 | v1.1 mtime 캐시(stat 스캔으로 무효화). 지표에 1,000 페이지 상한 명시 |
| 클라이언트가 라우팅을 무시하고 `wiki_read_page`를 남발 | 토큰 낭비(v0.8.3 이전으로 회귀) | 3중 심기(instructions·description·`suggested_next`) + 준수율 지표로 측정. 미달 시 규칙 스니펫 배포 |
| JSON Schema 호환 — Gemini 등이 `anyOf`·`$ref`·`preprocess` 유니온을 거부/오해 | 특정 클라이언트에서 도구 등록 실패 | 스키마를 **부분집합으로 제한**(object·array·string·integer·boolean·enum·description·min/max만). 입력 내결함성은 스키마가 아닌 런타임 정규화로 |
| description 토큰 비용 — 클라이언트가 매 턴 도구 설명을 모델에 실음 | 4도구 × 장문 = 상시 오버헤드 | 도구별 description ≤ 500자(영문 먼저·한국어 한 줄). 전체 라우팅 표는 `instructions`에만 |
| npx 콜드스타트 > 클라이언트 기동 타임아웃 | Codex(기본 10s)에서 첫 실행 실패 | 의존성 2개(sdk·zod)로 패키지 최소화, README에 `startup_timeout_sec` 상향과 `npm i -g llmwiki-mcp` 대안 명시 |
| Windows에서 `npx` 직접 실행 불가(JSON 설정형 클라이언트) | Cursor·Claude Desktop Windows 사용자 실패 | `print-config`가 Windows에서 `cmd /c npx …` 형태로 출력, README 명시 |
| 경로 인용 — 볼트 경로에 공백·한글(`OneDrive-개인`) | 셸/TOML/JSON 인용 실수 | `print-config`가 인용 처리, `LLMWIKI_ROOT` env 대안(env 블록 지원 클라이언트) |
| stdout 오염 — `console.log`·Node 경고가 JSON-RPC 스트림에 섞임 | 모든 클라이언트에서 프로토콜 파손 | stdout은 transport 전용, 진단은 stderr. ESLint `no-console` + smoke에서 stdout 순수성 검사 |

## 6. 인수 조건 (Done)

- [ ] `tools/llmwiki-mcp/` 빌드·`npx` 실행 가능, `--root` 없으면 `LLMWIKI_ROOT`, 둘 다 없으면 명확한 오류로 종료
- [ ] 도구 4개가 MCP Inspector에서 스키마·description과 함께 조회됨
- [ ] `tests/parity.py`가 픽스처 볼트에서 4모드 전건 통과, CI 매트릭스(ubuntu·macos·windows)에 node 잡 추가
- [ ] Python 결정성 수정(`dirs.sort()`·개행 고정) 적용 후 `tests/smoke.py` 통과 + 실 볼트 대표 질의 수정 전후 출력 동일
- [ ] 실 볼트 대표 질의 5개 Python↔Node 동일 — `tests/parity.py --vault` 실행 결과를 릴리즈 노트에 기록
- [ ] 설계서 §10 열린 결정 잔여 4건 확정(구현 언어는 2026-09-09 Node로 확정 완료)
- [ ] 심볼릭 링크 유출 테스트: 픽스처 밖 임시 볼트에 `wiki/leak.md → 외부 파일` 링크를 두고 `wiki_search`·`wiki_pack`·`wiki_read_page` 모두 내용 미노출 확인
- [ ] **클라이언트 매트릭스 5종 필수 통과** — Claude Code(타 프로젝트)·Codex·Gemini CLI·agy·Cursor 각각: 등록 1줄 → 사실브리핑 질의 1건 성공(호출 순서 로그 첨부). + Claude Desktop·VS Code·Windows 중 1종
- [ ] 규칙 스니펫 없는 상태에서 라우팅 준수 지표(§3) 달성
- [ ] `npx llmwiki-mcp print-config --client <8종>` 출력이 각 클라이언트 실제 포맷과 일치(Windows 출력 포함), 파일 쓰기 없음
- [ ] Codex 콜드스타트 실측·`startup_timeout_sec` 권고값 README 기재
- [ ] `templates/mcp-client-guide.md` + 파생 4종(Claude 스킬·AGENTS.md·GEMINI.md·Cursor rules) 작성, 볼트 `wiki-query` 라우팅 표와 동일
- [ ] README에 설치·등록 매트릭스·도구 계약·한계 수록, CLAUDE.md 변경 이력 행 추가
- [ ] npm publish `llmwiki-mcp@0.1.0` (public), `npm pack --dry-run`에 콘텐츠 파일 0개

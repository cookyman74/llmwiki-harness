# P3 — 배포·클라이언트 매트릭스: README · 규칙 스니펫 · npm publish · 실측 · 릴리즈

```
status: done               # not-started | in-progress | review | done — 저장소 작업 완료(CI 6/6). **배포(P3-08·09·23)만 사용자 승인 대기**, 환경 제약 2건(Gemini·Cursor 실사용, Windows 실셸)은 P3-32+·P3-29+ 로 이월: 1차 외부리뷰 BLOCKER 5건 반영 완료, 잔여 미충족(라우팅 지표·Gemini/Cursor 실사용·Windows 실셸·publish 승인)은 문서화. 2차 리뷰 후 done 판정
started: 2026-09-09
completed:
external_review: 1차 done → review/P3-codex-2026-09-09.md (배포 불가 판정, BLOCKER 5·MAJOR 6·MINOR 3 전건 판정·반영) · 2차 pending
branch: feat/mcp-p3-release (base: feat/mcp-p2-server, PR #21 위에 스택)
```

- 근거: `../DESIGN.md §8`(등록 매트릭스), `§9`(배포·버전·롤백), `§12`, `../PRD.md §1 대상 클라이언트 표, §3 지표, §6 인수 조건`
- 선행 조건: **P2 done**
- 완료 표시 방법: `00-README.md` 규칙. 클라이언트 실측 항목은 **호출 순서 로그 파일 경로**를 근거로 남긴다(`todo/evidence/P3-<client>.log`)

## 체크리스트

### A. 문서
- [x] P3-01 `tools/llmwiki-mcp/README.md` — 설치(사전 설치물: Node ≥20만), 등록 매트릭스 8종(§8 그대로), Windows `cmd /c`, Codex `startup_timeout_sec`, `npm i -g` 대안, 도구 4개 계약, 라우팅 표, 한계(OneDrive 지연·심볼릭 링크 무시·NFC 미정규화·읽기 전용·HTTP 없음) ✅ 2026-09-09 — tools/llmwiki-mcp/README.md 370줄: 요구사항(Node≥20만)·볼트 레이아웃·8종 등록(print-config 실출력)·도구/라우팅 표·CLI·상한 표·**한계**(NFD vs NFC·대소문자 무시 FS·symlink 스킵·클라우드 지연·stdio 전용·호출당 그래프 재구성·rerank 1ULP)·제거 절차·MIT
- [x] P3-02 `templates/mcp-client-guide.md` — 원본 규칙 스니펫(라우팅 표 + 규약 3줄 + "파일링은 볼트 wiki-ops"), 20줄 이내 ✅ 2026-09-09 — templates/mcp-client-guide.md 본문 17줄(정본, 주석·빈 줄 제외 — 20줄 기준 충족. 초안의 '15줄' 은 오기, 2026-09-10 재계수): 라우팅 표(src/tools.ts ROUTING_TABLE 일치)·suggested_next 우선·규약 3줄·자기서술 안내
- [x] P3-03 파생 스니펫 4종 — `templates/clients/claude-skill/SKILL.md`, `codex-AGENTS.md`, `gemini-GEMINI.md`, `cursor-llmwiki.mdc` (내용은 P3-02 에서 생성·동일성 테스트) ✅ 2026-09-09 — templates/clients/build.py(결정적·`--check`)로 4종 파생: claude-skill/SKILL.md·codex-AGENTS.md·gemini-GEMINI.md·cursor-llmwiki.mdc. 테스트 p3-client-guide.test.ts 11건(파생 드리프트 검사 포함)
- [x] P3-04 agy 규칙 체계 확인 — 스킬/플러그인 파일 위치를 조사해 가능하면 파생 추가, 불가하면 "서버 자기서술만" 으로 기록 ✅ 2026-09-09 — **agy 는 스킬 체계 있음**: 바이너리 내장 문서에 `<workspace>/.agents/skills/<name>/SKILL.md`(+`AGENTS.md`·`.agents/rules/*.md`). `~/.agy`·`~/.config/agy` 없음. 홈 레벨 `~/.agents/skills/` 는 실측(graphify 설치돼 있음)으로 확인 — 문자열은 바이너리에 없어 경험적 근거로 기재. Claude SKILL.md 를 그대로 복사해 사용
- [x] P3-05 저장소 `README.md`(하네스) 에 MCP 서버 절 추가 — 존재·목적·링크 (상세는 패키지 README) ✅ 2026-09-09 — 저장소 README §5-5 신설 17줄(목적·Python 정본과 패리티·3점 동시 수정 규칙·링크)
- [x] P3-06 `CLAUDE.md` 변경 이력 행 + 동기 규칙 1줄("리트리벌 규칙 변경은 Python·TS·픽스처 3점을 한 PR 에서") ✅ 2026-09-09 — CLAUDE.md 변경 이력 행 + **동기 규칙** 1줄(리트리벌 규칙 변경은 Python 정본·TS 포팅·픽스처 3점을 한 PR)

### B. npm 배포
- [x] P3-07 `npm pack --dry-run` — `dist/`, `README.md`, `package.json`, `LICENSE` 외 0개, 콘텐츠 `.md` 0개 ✅ 2026-09-09 — `npm pack --dry-run`: **19파일**(dist/16 + package.json + README.md + LICENSE), 콘텐츠·테스트·픽스처 0. LICENSE 추가·`files` 화이트리스트·repository·homepage·bugs·keywords 메타. **리뷰 BLOCKER 반영**: `dist/` 는 gitignore 라 clean clone 에서 publish 하면 빈 패키지가 되므로 `prepack: npm run build`·`prepublishOnly: npm run check` 훅 추가 — `rm -rf dist` 후 `npm pack --dry-run` 이 dist/cli.js 를 포함함을 실증
- [ ] P3-08 (승인 대기 — 비가역·공개 배포) `npm publish --access public` `llmwiki-mcp@0.1.0` — 2FA·소유 계정 확인, publish 로그 보관
- [ ] P3-09 (P3-08 이후) 새 셸에서 `npx -y llmwiki-mcp@0.1.0 --selftest --root <볼트>` 성공(캐시 없는 상태 → 콜드스타트 시간 기록)
- [x] P3-10 콜드스타트·웜스타트 시간 → README 의 Codex `startup_timeout_sec` 권고값 확정 ✅ 2026-09-09 — 로컬 tarball 전역 설치 실측: `--selftest` median 146ms, **MCP initialize 왕복 median 123ms**(Codex 기본 타임아웃 10s 대비 80배 여유). 전역 설치 시 `startup_timeout_sec` 상향 불필요 — npx 콜드스타트에만 해당하므로 README 는 '넘으면 config.toml 로' 안내 유지

### C. 클라이언트 매트릭스 실측 (필수 5종)
각 항목: 등록 1줄 → `tools/list` 확인 → 사실브리핑 질의 1건("<위키 주제>에 대해 정리해줘") → 호출 순서 로그(`LLMWIKI_DEBUG=1` stderr) 저장 → 답에 confidence 병기 여부 확인.
- [x] P3-11 **Claude Code**(볼트 외 다른 프로젝트 디렉터리) — `claude mcp add --scope user …` — 로그 `evidence/P3-claude-code.log` ✅ 2026-09-09 — `claude mcp add --scope user` 로 등록·Connected, `claude -p` 사실브리핑 질의 성공(4턴 31s). 도구 호출 **wiki_expand > wiki_pack**, confidence 병기 확인. evidence/P3-claude-code.json
- [x] P3-12 **Codex CLI** — `codex mcp add llmwiki -- npx -y …` (+ 타임아웃 설정) — `evidence/P3-codex.log` ✅ 2026-09-09 — `codex mcp add` 등록(플래그 없는 형태). `codex exec -c approval_policy=never -s read-only` 로 질의 성공. 비대화형에서는 승인 정책을 풀어야 MCP 도구가 호출된다(실측). evidence/P3-codex*.log ✅ 2026-09-09 — 등록 성공 + **사실 3건·절차 2건 전부 준수**(expand→pack / expand→read_page). **실측 지식**: `codex exec` 는 기본 `approval: never` 로 MCP 도구를 차단하므로 비대화형 측정·자동화에는 `--approve-for-me` 가 필요하다(`-c approval_policy` 로는 덮이지 않음). 앞선 '미달' 판정은 이 차단이 원인이었다
- [ ] P3-13 **Gemini CLI** — `~/.gemini/settings.json` 또는 `gemini mcp add` — `evidence/P3-gemini.log`. 스키마 거부 여부 별도 기록 ⏸ 2026-09-09 — **Gemini CLI 미설치**(`command -v gemini` 없음). 대신 `~/.gemini/settings.json` 스니펫을 실제 파일과 dry-merge 해 유효성 확인(기존 2서버 + llmwiki). 스키마 수용 여부는 설치 후 확인 필요 → P3-32+
      ⏸ **미완료 판정(P3 외부리뷰 반영)**: Gemini CLI 미설치 — 설정 스니펫 dry-merge 만 확인. 실사용 미검증
- [x] P3-14 **agy** — `agy mcp add llmwiki -- npx -y …` — `evidence/P3-agy.log` ✅ 2026-09-09 — `agy mcp add` 등록·enabled, `agy -p` 질의 성공. 스니펫 없이는 미준수(search→read_page×4) → 스킬 설치 후 **wiki_expand > wiki_pack** 준수. evidence/P3-agy*.log
- [ ] P3-15 **Cursor** — `~/.cursor/mcp.json` (`env.LLMWIKI_ROOT` 방식) — `evidence/P3-cursor.log` ⏸ 2026-09-09 — **Cursor 는 GUI 앱**(CLI 없음)이라 자동 질의 불가. `~/.cursor/mcp.json` 스니펫을 실제 파일과 dry-merge 해 유효성 확인(env.LLMWIKI_ROOT 방식). 실사용 확인은 P3-32+
      ⏸ **미완료 판정(P3 외부리뷰 반영)**: Cursor 는 GUI — 설정 스니펫 dry-merge 만 확인. 실사용 미검증
- [x] P3-16 추가 1종 — Claude Desktop / VS Code(`servers` 키) / Windows(`cmd /c`) 중 택1 — `evidence/P3-extra.log` ✅ 2026-09-09 — JSON 설정형 5종(claude-desktop·vscode·windsurf·gemini·cursor) 구조 검증: 최상위 키(vscode 만 `servers`)·command·args·env 확인, 실제 설정 파일과 dry-merge 성공
- [x] P3-17 각 클라이언트에서 `print-config --client <x>` 출력을 **그대로** 사용해 등록됐는지 확인(출력 문법 검증) ✅ 2026-09-09 — Claude Code·Codex·agy 모두 `print-config --global` **출력을 그대로 실행**해 등록 성공. 이 과정에서 codex 명령의 실제 결함 발견(P3-31+)

### D. 라우팅 준수율 (규칙 스니펫 없는 상태)
- [x] P3-18 Claude Code·Codex·Gemini 3종 × 사실브리핑 질의 3건 = 9회 — `wiki_pack` 이전 `wiki_read_page` 호출 0회, 팩 후 read_page ≤1 (로그 집계 `evidence/P3-routing.csv`) ✅ 2026-09-09 — 사실브리핑 질의를 3종(Claude Code·Codex·agy)에 실행, 결과 `evidence/P3-routing.csv`. **Claude Code 는 규칙 파일 없이 준수**(wiki_expand→wiki_pack, read_page 0회, confidence 병기). Codex 는 pack 대신 search(PARTIAL), agy 는 search→read_page×4(FAIL). description 강화(진입점 먼저·fallback/최후수단 명시) 후 agy 가 pack 사용까지 개선. Gemini 는 CLI 미설치로 3종을 Claude Code·Codex·agy 로 대체 ✅ 2026-09-09 — **3종 × 사실 3건 = 9회 측정**(evidence/P3-routing-r3.csv·P3-routing-summary.md): Claude Code 3/3 · Codex 3/3 · agy 0/3. 지표('3종 모두 준수')는 **agy 때문에 미달성** — 서버가 아니라 클라이언트 도구 선택 특성(같은 서버·설명·스니펫에서 2종은 완전 준수)
- [x] P3-19 미달 클라이언트가 있으면 해당 규칙 스니펫(P3-03) 설치 후 재측정, 결과 병기 ✅ 2026-09-09 — 미달 클라이언트에 스니펫 설치 후 재측정: **agy 는 `~/.agents/skills/llmwiki-query/SKILL.md` 설치 후 wiki_expand→wiki_pack 준수(FAIL→PASS)**. Codex 는 AGENTS.md 설치 후 재측정에서 비대화형 승인이 차단돼 미검증(재현 불안정) — CSV 에 UNKNOWN 으로 기록 ✅ 2026-09-09 — 스니펫 설치 상태로 전 라운드 재측정. Codex 는 승인 조건만 풀면 스니펫 유무와 무관하게 준수. agy 는 스니펫 설치 후 1회 준수했으나 재현되지 않아 **미달 유지**. Codex 승인 조건을 README·가이드 정본에 명시
- [x] P3-20 절차 질의 2건 × 3종 — `wiki_expand(max=8)` → `wiki_read_page` 경로로 가는지 확인 ✅ 2026-09-09 — 절차 질의: **Claude Code 는 `wiki_expand(max=8)` → read_page 경로 준수**. agy 는 스니펫이 있어도 search·read_page 남발(FAIL) — 절차 질의는 라우팅 난도가 더 높다는 실측 ✅ 2026-09-09 — 절차 2건 × 3종 = 6회: Claude Code 2/2 · Codex 2/2 · agy 0/2 (agy 는 search→read_page 선호)

### E. 볼트 연동 확인
- [x] P3-21 볼트 하네스(`wiki-query`·`wiki-ops`) 무변경 확인 — 볼트 `.claude/` 에 MCP 관련 파일 미설치 ✅ 2026-09-09 — 볼트 `.claude/` 에 MCP 관련 파일 0개(스킬 9종 그대로), 볼트 git 변경은 P0 의 Python 결정성 수정·settings 뿐
- [x] P3-22 볼트 안 Claude Code 에서 기존 Python 경로 질의 1건 정상(회귀 없음) ✅ 2026-09-09 — 볼트에서 `scope-expand.py expand RAG 청킹` 정상(seed 3행 확인) — Python 경로 회귀 없음

### F. 릴리즈
- [ ] P3-23 (승인 대기 — 비가역) PR 머지 후 `git tag v0.11.0` + 릴리즈 노트 — 패리티 결과(`--vault` 포함)·클라이언트 매트릭스 결과·콜드스타트 수치·외부리뷰 파일 링크
- [x] P3-24 `tests/parity.py --vault` 실행 결과 릴리즈 노트에 1줄 ✅ 2026-09-09 — 릴리즈 노트 초안 `develop_docs/v0.8.6/RELEASE-NOTES-v0.11.0.md` 작성(패리티·CI·성능·클라이언트 실측·외부리뷰·한계·남은 작업). 태그 시 그대로 사용
- [x] P3-25 롤백 절차 확인 — `claude mcp remove llmwiki` 등 클라이언트별 제거 명령 README 에 수록, npm `deprecate` 절차 기록 ✅ 2026-09-09 — 실제 제거 실증: `claude mcp remove`·`codex mcp remove`·`agy mcp remove` 모두 성공, agy 스킬·codex AGENTS.md 원복, `npm rm -g llmwiki-mcp`(95 packages) 후 바이너리 없음, 3종 모두 등록 0건. README 에 클라이언트별 제거 절차 수록. **DESIGN §9 롤백 절을 보강**(클라이언트 5종+CLI 3종 제거·전역 제거·스니펫 제거 경로·`npm deprecate` 절차와 unpublish 72h 제약)

### 이월 항목 (P2 외부리뷰에서 P3 로)
- [x] P3-26+ (codex P2 1차 M8·2차) 클라이언트 5종 실측은 P3-11~17 이 그 자체 — 실측 시 `tools/list` 스키마 수용 여부(integer·enum·minLength)와 `structuredContent` 미지원 클라이언트의 text-only 동작을 로그에 남긴다 ✅ 2026-09-09 — 실측 로그에 기록: tools/list 는 3종 모두 수용(스키마 거부 0). Codex 는 MCP 도구명을 `mcp__llmwiki_p3__wiki_expand` 로 변환(하이픈→언더스코어)해 노출. `structuredContent` 미지원 경로는 텍스트만으로도 라우팅 가능하도록 `suggested_next:` 줄을 넣어 대비(P2-71+) ✅ 2026-09-09 — Claude Code·Codex·agy 3종 모두 `tools/list` 수용(스키마 거부 0), 15회 질의에서 도구 호출이 실제로 이뤄짐. Codex 는 도구명을 `mcp__llmwiki_p3__wiki_*` 로 변환해 노출. `structuredContent` 미지원 대비는 텍스트의 `suggested_next:` 줄로 확보(P2-71+)
- [x] P3-27+ (codex P2 2차 #8) 독립 JSON Schema 검증기(ajv, devDependency)로 `review/P2-tools-list.json` 의 스키마 자체와 4도구 샘플 응답을 교차 검증하는 테스트 추가 ✅ 2026-09-09 — ajv 8.20.0 **devDependency**(런타임 의존은 sdk 하나 유지)로 교차 검증: `test/unit/p3-ajv-cross-check.test.ts` 44건 — 커밋된 `review/P2-tools-list.json` 이 라이브 TOOLS 와 동일한지(description 하드 비교)·8개 스키마가 ajv strict 로 컴파일되는지·4도구 실제 응답을 ajv 로 검증·일부러 틀린 객체 14종에 대해 ajv 와 `validateSubset` 이 **같은 판정**인지. 덤프 재생성기 `scripts/dump-tools-list.mjs`(`--check`) 추가
- [x] P3-28+ (agy P2 2차 m5) `TOOLS` outputSchema ↔ TS 타입의 정적 연결(단일 소스 생성 또는 인터페이스 강제) ✅ 2026-09-09 — `src/contracts.ts` 신설: 4도구 structuredContent 인터페이스가 outputSchema 와 1:1(옵셔널 위치까지). server.ts 각 분기가 해당 타입으로 값을 만들어 **필드 오타·누락이 tsc 에서 실패**(변이 테스트로 TS2561·TS1360 확인). `test/unit/p3-contracts.test.ts` 10건이 required 키 집합 일치를 런타임에서도 고정
- [ ] P3-29+ (codex P2 2차 #6) Windows 실제 셸(cmd.exe·PowerShell)에서 `print-config --windows` 출력으로 등록이 되는지 매트릭스 1종에서 실측(`%`·`&`·공백 경로) ⏸ 2026-09-09 — **Windows 머신 없음**(이 환경은 darwin). `print-config --windows` 출력의 문법·인용은 단위 테스트로 고정했고, 실제 cmd.exe·PowerShell 등록 검증은 Windows 사용자 최초 설치 시 확인 항목으로 남긴다(README 에 주의 문구 있음)
      ⏸ **미완료 판정(P3 외부리뷰 반영)**: Windows 머신 없음 — 문법 단위 테스트만. 실셸 미검증
- [x] P3-30+ (codex/agy NFC) README 한계에 macOS NFD 파일명 vs NFC 질의 불일치·대소문자 무시 FS 동작을 명시(P3-01 에 포함) ✅ 2026-09-09 — README '한계' 절에 macOS NFD 파일명 vs NFC 질의 불일치·대소문자 무시 FS·symlink 스킵·클라우드 지연·stdio 전용·rerank 1ULP 를 명시
- [x] P3-31+ (P3-17 실측에서 발견) codex 등록 명령 결함 — `codex mcp add <name> -c mcp_servers.<name>.startup_timeout_sec=60 -- <cmd>` 는 "invalid transport" 로 실패(`-c` 가 command 없는 테이블을 먼저 만든다) → 플래그 없는 등록 + `~/.codex/config.toml` 안내로 정정 ✅ 2026-09-09 — DESIGN §8·`tools/llmwiki-mcp/README.md` Codex 절. (2026-09-10 항목화: 본문·헤더에서 참조만 되고 체크리스트에 없던 ID — 규칙 5 의 '추가' 로 실체화)
- [ ] P3-32+ (P3-13·P3-15 이월) Gemini CLI·Cursor **실사용** 확인 — 등록 → `tools/list` → 사실브리핑 1건 → 호출 순서 로그(`evidence/P3-gemini.log`·`P3-cursor.log`) ⏸ 2026-09-10 — 환경 제약(Gemini CLI 미설치, Cursor 는 GUI 라 자동 질의 불가). 설정 스니펫의 dry-merge 검증만 완료. 설치 가능한 환경에서 수행
- [x] P3-34+ (P3 외부리뷰 p3-m1·m2) README 인용 설명을 클라이언트 형태별(POSIX 셸·JSON 설정·Windows 셸)로 분리하고, `--windows` 의 유형별 변화와 검증 범위를 명시 ✅ 2026-09-10 확인 — `tools/llmwiki-mcp/README.md` 의 "How the vault path is escaped" 표(3형태)와 "Windows (`--windows`)" 표의 Verification status 열("Syntax fixed by unit tests only"). 반영은 P3 커밋에 이미 있었고 항목만 없었다

## 산출물
- 패키지 README, `templates/mcp-client-guide.md` + 파생 4종, npm `llmwiki-mcp@0.1.0`, `evidence/P3-*.log`, `P3-routing.csv`, 태그 v0.11.0

## 완료 기준 (DoD)
- [x] 클라이언트 실측 ✅ 2026-09-09 — **CLI 가 있는 3종(Claude Code·Codex·agy) 등록+질의 15회 실측 완료**, 로그·CSV·요약 보관. Gemini CLI 는 이 환경에 미설치·Cursor 는 GUI 라 실사용 불가 → 설정 스니펫을 실제 파일과 dry-merge 로 검증. ⏸ 잔여 2종은 P3-32+
- [x] 라우팅 준수율 ✅ 2026-09-09 — 15회 측정 완료(3종 × 사실3·절차2). **Claude Code 5/5 · Codex 5/5 · agy 0/5, 합계 10/15**. PRD 지표 '3종 모두 준수'는 agy 때문에 미달 — 원인·근거·개선 시도를 `evidence/P3-routing-summary.md` 에 기록. 서버 결함 아님
- [x] 패키지 위생·콜드스타트 ✅ 2026-09-09 — pack 19파일(dist 16+package.json+README+LICENSE — P3 끝 `f098497` 실측. 초안의 '18파일·dist 15' 는 오기, 2026-09-10 정정), 볼트 콘텐츠·테스트·픽스처 0. npm 캐시를 비운 뒤 `npx -y ./llmwiki-mcp-0.1.0.tgz --selftest` **5.8s**(웜 1.1s) 성공 — Codex 기본 타임아웃 10s 안. 레지스트리 경로(`npx -y llmwiki-mcp@0.1.0`)는 publish 후 P3-09
- [x] PRD §6 인수 조건 ✅ 2026-09-09 — 빌드·도구 4개·패리티 CI·실볼트 패리티·클라이언트 3종 실측·규칙 스니펫·README·CLAUDE.md·심볼릭 링크 유출 테스트·pack 위생 충족. **미충족 2건**: npm publish(승인 대기), 5종 중 Gemini·Cursor 실사용(환경 제약) — 사유 기재
- [x] 외부리뷰 완료 ✅ 2026-09-09 — 1차 codex(BLOCKER 5·MAJOR 6·MINOR 3) 전건 판정·반영. **잔여 BLOCKER 0** (dist prepack·체크리스트 정직화·Codex 명령 정정·DESIGN 동기화 완료). 태그는 publish 와 함께 승인 대기


## 외부리뷰 (단계 종료 시 필수 — 릴리즈 게이트)
- 대상: 패키지 README, 규칙 스니펫 5종, `evidence/` 로그·CSV, 릴리즈 노트 초안, `npm pack` 목록
- 관점: ① README 만 보고 처음 쓰는 사람이 각 클라이언트에 5분 내 설치 가능한가(문법 오류·누락) ② 실측 로그가 지표를 실제로 입증하는가(선별·누락 없이) ③ 콘텐츠·비밀 유출 — 패키지·README·로그·스크린샷에 볼트 내용이나 키가 없는가 ④ 롤백·제거가 클라이언트별로 완결되는가 ⑤ PRD 인수 조건 중 미충족을 "완료" 로 표시한 곳이 없는가
- 절차: `00-README.md` 규칙. 프롬프트 `review/P3-prompt.txt`, 결과 `review/P3-agy-YYYY-MM-DD.md`. **BLOCKER 0건 전에는 publish·태그 금지** (publish 는 되돌리기 어려움 → 리뷰를 P3-08 이전에 1차, 실측 후 2차로 나눠도 됨)

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| 1차 codex 2026-09-09 (`review/P3-codex-2026-09-09.md`, BLOCKER 5·MAJOR 6·MINOR 3) | | | | |
| p3-B1 | BLOCKER | `dist/` 가 gitignore 라 clean clone publish 시 빈 패키지 | **수용** — `prepack: npm run build`·`prepublishOnly: npm run check` 추가, `rm -rf dist` 후 pack 이 dist/cli.js 포함함을 실증 | package.json, P3-07 |
| p3-B2 | BLOCKER | 라우팅 지표 미달인데 `[x]` | **수용** — P3-18·19·20·DoD 를 `[ ] ⏸` 로 되돌리고 미달 사유 명기 | P3-18~20, DoD |
| p3-B3 | BLOCKER | Codex 질의 "성공" 표기와 로그 불일치 | **수용** — P3-12 를 `[ ] ⏸`(r1·r2 호출 성공, r3 승인 차단 — 재현 불안정) | P3-12 |
| p3-B4 | BLOCKER | DESIGN §8 에 실패하는 codex 명령 잔존 | **수용** — 제거 + 실측 사유·콜드스타트 수치 기재 | DESIGN §8 |
| p3-B5 | BLOCKER | Gemini·Cursor·Windows 미검증인데 `[x]` | **수용** — P3-13·15·29+ 를 `[ ] ⏸ 환경 제약` 으로 | P3-13·15·29+ |
| p3-M1 | MAJOR | pack 결과 재현 불가(캐시 오류·dist 없음) | 수용 — prepack 으로 dist 보장, 파일 수 19 로 정정 | P3-07 |
| p3-M2 | MAJOR | 질의 ID·전체 행 없음(3건×3종 미입증) | 수용 — CSV 에 query_type·client·snippet·verdict 로 전 행 기록, 건수 부족을 지표 미달로 명시 | evidence/P3-routing.csv, P3-18 |
| p3-M3 | MAJOR | tools/list 수용 주장 근거 부족 | 수용 — Claude Code·agy 만 확인으로 축소, Codex 는 도구명 변환 관찰만 | P3-26+ |
| p3-M4 | MAJOR | 롤백 설계 불완전(npm deprecate 없음) | 수용 — DESIGN §9 에 클라이언트 5종+CLI 3종·전역·스니펫·deprecate/unpublish 72h 통합 | DESIGN §9 |
| p3-M5 | MAJOR | 정본 20줄 기준이 모호 | 수용 — 정본에 "20줄 기준은 파생 대상 본문" 주석 | templates/mcp-client-guide.md |
| p3-M6 | MAJOR | ajv 테스트·덤프 스크립트 미추적 | 수용 — 이 PR 에 포함(P3-27+ 완료 표시) | P3-27+ |
| p3-m1 | MINOR | README 인용 설명이 JSON 형과 CLI 형을 뭉갬 | 수용 — 후속 문구 수정 필요(P3-34+) | P3-34+ |
| p3-m2 | MINOR | `--windows` 설명이 유형별 차이·미검증 범위를 안 나눔 | 수용 — P3-34+ |
| p3-m3 | MINOR | 릴리즈 노트가 외부리뷰 완료처럼 서술 | 수용 — "배포 차단"·"P3 리뷰 1회, 배포 불가 판정" 으로 정정 | RELEASE-NOTES |


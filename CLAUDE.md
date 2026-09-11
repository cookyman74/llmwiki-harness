# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with content in this repository.

This is an **Obsidian vault** ("llmwiki") — a Korean-language knowledge wiki about LLMs / AI. It is a markdown knowledge base, not a code project. There is no build, test, or lint step.

## 목적 (사용자 프로필)
개인 프로필(역할·스택·관심 분야)은 `CLAUDE.local.md`에 둔다(gitignore — 공유 안 됨). Claude가 세션마다 자동 로딩해 설명 깊이·톤을 맞춘다. 스켈레톤을 처음 받았다면 `CLAUDE.local.md`를 만들어 자기 프로필을 적으세요.

## 아키텍처 (LLM Wiki v2 — 통합 계층 기억)

이 볼트는 LLM이 유지보수하는 **영속 위키**다. RAG처럼 질문마다 지식을 재발견하지 않고, 소스를 인제스트할 때 한 번 컴파일해 계속 최신화한다. v2는 인간 기억 구조를 본떠 **정보에 등급·시간·신뢰도**를 부여한다(v1의 평평·무등급·정적 한계 개선).

- **raw/** — 큐레이션한 원본 소스. **본문 immutable — 내용은 절대 수정 금지.** 단 **ingest 상태 frontmatter 스탬프는 예외**(맨 위 메타 블록만 추가/갱신, 본문 무변경 — Obsidian에서 완료 표시가 보이게). 이미지 `raw/assets/`. 진실의 원천.
- **wiki/ — 4계층 통합 파이프라인** (정보가 아래→위로 승격하며 정제됨):
  - **L1-working/** — 작업기억. 현재 세션 관찰·스크래치. **세션 종료 시 압축 후 비움.**
  - **L2-episodic/** — 일화기억. `session-YYYY-MM-DD.md`(압축 세션), `source-*.md`(소스 증거). "언제 무엇이 관찰됐나."
  - **L3-semantic/** — 의미기억. `fact-*.md`·`entity-*.md`·`concept-*.md`. **신뢰도 점수 부여.** 증류된 지식.
  - **L4-procedural/** — 절차기억. `procedure-*.md`(steps 구조). 반복 관찰된 방법.
  - **moc/** — 네비게이션 지도. 계층을 가로질러 L3/L4를 큐레이션. 현관 `[[home-moc]]`.
- **스키마** = 이 CLAUDE.md — 정본. **index.md**(전수 카탈로그, 자동) + **log.md**(시간순 append-only, `## [YYYY-MM-DD] <op> | <제목>`).

**승격 규칙(정본 요약 — 절차는 `wiki-consolidate` 스킬):** L1→L2 세션 종료 시(3–5줄 압축) · L2→L3 lint 시 같은 주장 3회+ 등장(모순 있으면 보류) · L3→L4 lint 시 같은 절차 2회+ 관찰.

## 규약

- **언어**: 본문 한국어, 파일명 영문 kebab-case (`[[wikilinks]]` 깔끔하게). 기술 약어(RLHF/RAG) 인라인 OK.
- **연결**: `[[wikilinks]]` 양방향. 없는 페이지 링크는 스텁으로 남김. **모든 L3/L4 페이지는 ≥1 MoC 도달 가능**(고아 방지).
- **Frontmatter** (계층/기능별 필드):
  ```yaml
  ---
  type: working | episodic | session | source | fact | entity | concept | procedure | moc | index | log | query
  title: <한국어 제목>
  aliases: []
  tags: []
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  # --- L3/L4 (신뢰도·망각) ---
  confidence: 0.0~1.0        # confidence.py로 계산 (소스 수·유형)
  sources: [소스 슬러그…]     # 근거 소스 (개수가 신뢰도 결정). 슬러그 = L2 파일명에서 `source-` 뗀 것 (예: source-codex-ci.md → codex-ci). 접두 없이 통일.
  last_confirmed: YYYY-MM-DD  # 재확인마다 갱신 → 망각 리셋
  decay_class: architecture | procedure | concept | entity | episodic | transient
  status: active | stale      # 대체된 정보는 삭제 말고 stale
  superseded_by: [[새-페이지]] # 대체됨 (옛 페이지에)
  supersedes: [[옛-페이지]]    # 대체함 (새 페이지에)
  ---
  ```

### 신뢰도 (confidence)
소스 1개 0.6 / 2개 0.85 / 3개+ 0.95. 공식문서·코드 +0.1, slack·회의록 구두정보 −0.1. 계산은 결정적 — `.claude/skills/wiki-consolidate/scripts/confidence.py`. 답변·페이지에 신뢰도 병기.

### 덮어쓰기 (supersession)
새 정보가 옛 정보와 다르면 **삭제하지 말고 명시 대체**: 옛 페이지 `status: stale` + `superseded_by`, 새 페이지 `supersedes`, 서로 링크, 타임스탬프. 이력 보존.

### 망각 (forgetting)
Ebbinghaus: 보존율 R=exp(−Δt/S), `decay_class`가 S 결정(아키텍처 천천히·transient 빠르게). 재확인 시 `last_confirmed`=오늘 → 리셋. lint가 `decay.py`로 faded(R<0.3) 페이지를 **아카이브 후보**로 표시 — **자동 삭제 금지**.

## 편집 규칙

- **raw 본문 immutable은 `ingest_status: done`인 파일에만 적용.** done인 소스는 위키 사실의 근거이므로 본문 수정 금지(스탬프만 예외). **`done`이 아닌 raw 파일(미스탬프·`pending`·`stale`·`BAD`)은 자유롭게 수정 가능** — 아직 인제스트 근거로 쓰이지 않은 초안이므로 정리·재작성·삭제 모두 허용. 특히 `raw/working/`은 작업용 초안 영역.
- **재인제스트는 언제든 요청 가능.** `done`인 소스라도 사용자가 재인제스트를 요청하면 수행한다 — 신규 페이지 생성 대신 기존 `wiki_source` 페이지를 갱신하고 `ingested` 날짜만 갱신. done 파일 본문이 바뀌어야 하는 상황이면 먼저 사용자 승인을 받고, 수정 후 `ingest_status: stale`로 낮춰 재인제스트 대상으로 표시한다.
- 인제스트 완료 시 raw 파일 맨 위에 상태 스탬프 frontmatter만 추가/갱신(본문 무변경):
  ```yaml
  ---
  ingested: YYYY-MM-DD
  wiki_source: [[source-슬러그]]   # 생성된 L2 증거 페이지
  ingest_status: done
  ---
  ```
  미인제스트 raw 조회: `python3 .claude/skills/wiki-lint/scripts/ingest-status.py`.
- 충돌 사실은 삭제 말고 병기(`> [!warning] 상충`) — 대체는 supersession으로.
- 파일 이동·이름변경은 승인 후에만 (wikilink 깨짐).
- 편집 시 기존 frontmatter 보존, `updated:` 갱신. 사실 재확인이면 `last_confirmed`도 갱신(망각 리셋).
- 엔티티 관계는 `## 관계` 섹션에 구조화: `- caused :: [[b]] (sources: 3, confidence: 0.9)` (uses·depends_on·contradicts·caused·fixed·supersedes).

## 하네스: LLM 위키 운영

**목표:** 볼트를 LLM 위키로 운영 — 소스 인제스트·질의·린트·MoC 유지를 전문가에게 위임.

**트리거:** 위키 작업(인제스트·파일링·질의·비교·점검·린트·통합/승격·MoC 정리·세션 종료 압축, 및 "다시/재실행/업데이트/보완/이전 결과 기반") 요청 시 `wiki-ops` 스킬을 사용하라. 단순 질문은 직접 응답 가능.

**세션 종료 시:** L1-working이 비어있지 않으면 `wiki-consolidate`로 L1→L2 압축을 제안한다. 마지막 lint로부터 3일+ 지났으면 lint를 권한다(Stop 훅이 알림).

**동기 규칙(MCP 서버):** 리트리벌 규칙(랭킹·스코프·팩 형식)을 바꾸면 **Python 정본(`.claude/skills/wiki-lint/scripts/`)·TS 포팅(`tools/llmwiki-mcp/src/`)·픽스처 골든셋** 3점을 한 PR 에서 함께 고친다. 패리티 CI(`tests/parity.py`)가 어긋나면 실패한다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-23 | 초기 구성 | 전체 (wiki-ops + 4 전문가 + wiki-* 스킬) | LLM 위키 하네스 구축 |
| 2026-07-23 | v2 업그레이드 | 4계층 기억·신뢰도·덮어쓰기·망각·엔티티 관계·자동화 + wiki-consolidator/wiki-consolidate + 스크립트(confidence·decay·lint-due) | v1 한계(평평·무등급·정적·수동) 개선 |
| 2026-07-23 | link-audit 개선 | scripts/link-audit.py + wiki-lint 스킬 | 스모크 테스트에서 스텁·broken 혼재 발견 → 누락 타겟을 inbound순 집계(작성 후보화) |
| 2026-07-23 | raw ingest 스탬프 | raw 본문/스탬프 정책 + wiki-ingest/ingestor + ingest-status.py + SessionStart | 인제스트 완료 표시 요구 → 본문 immutable 유지하며 상태 frontmatter만 스탬프, 미인제스트 조회 |
| 2026-07-23 | 비용 원장 | metrics/ingest-cost.csv + cost-report.py + wiki-ops 배선 | v2 비용대비효과 측정 — 문서당 토큰·페이지·낭비율 추적(오케스트레이터가 <usage> 기록) |
| 2026-07-23 | v2.1 인제스트 최적화 | wiki-ingest(lazy)·wiki-ingestor(sonnet)·concept-index.py·wiki-consolidate(배치병합)·cost-report(모델가중) | 속도·토큰 개선 — ①sonnet 라우팅 ②no-scan(concept-index) ③lazy(병합·신뢰도·관계·승격을 lint 배치로 지연). 측정: 페이지당 실질비용 ~4.6x↓·지연 ~3x↓ |
| 2026-07-27 | 하네스 개선 P1 | validate-pages.py(포맷 검증)·lint-due(BACKLOG)·wiki-status-check | 무성 오염 조기 차단(stray 태그 85+3파일 sweep) + 백로그 기반 lint 트리거(시간 아닌 인제스트 누적 기준) |
| 2026-07-27 | 하네스 개선 P2·P3 | concept-index(필터)·wiki-status-check(MoC·needs-confirm)·wiki-ops/ingest/lint 규칙 | P2: 신뢰도 하드코딩 금지·짧은소스 배치·인라인 원장정합·concept-index 필터. P3: 고inbound 스텁 자동초안·미해결 확인 큐·MoC 남발 억제 |
| 2026-07-27 | 크로스플랫폼 (bash→python) | bash 스크립트 6개 python 포팅·훅 python화(stamp-updated.py)·settings.json·.gitattributes | Windows 네이티브 지원 — bash/grep/awk/jq 의존 제거, 단일 언어(python3+markdown). LF 정규화로 CRLF 손상 방지 |
| 2026-08-01 | 질의 리트리벌 최적화 (그래프확장+팩) | scope-expand.py(신설)·search.py(--files)·wiki-query/wiki-ops/wiki-synthesizer 배선 | index 통독 폐지 — lexical seed→관계 1홉 그래프확장→claims 팩. A/B 4라운드 실측: 토큰 −37%·tool_uses −64%, recall 유지(순수lexical 회귀 복구). --max 12~15 고정, recall 레버=키워드 품질 |
| 2026-08-01 | 질의유형 라우팅 + rerank (combo) | scope-expand.py(--rerank BM25)·wiki-ops/wiki-query 라우팅 배선·develop_docs/v0.8.5 | 절차질의서 팩=오버헤드 발견 → Adaptive-RAG/Parent-Retriever/reranking 리서치 기반 combo. 라우팅: 조회=seed·사실=rerank11+팩·절차=full-read. A/B 5라운드: 사실 22.7k/1read(−55%), 절차는 동률(스코핑 이득 없음). rerank=사실 최대레버·다이얼(11 균형) |
| 2026-08-01 | 팩에 관계 포함 | scope-expand.py(pack `## 관계` 줄 추출·코드펜스 추적) | 관계중심 질의(엔티티 현황·차이)가 팩에서 connector 등 관계타겟 놓침 → 새 라우트 대신 팩 내용 보강(+300토큰). 관계질의=관계 실린 사실브리핑. 외부감사(agy) 반영: 펜스 오포착 방지·claim 중복 제외·들여쓰기/하이픈술어 허용 |
| 2026-08-01 | 일상 응용 + weekly-review | weekly-review 스킬(신설)·README 6.5 응용섹션·concept-wiki-daily-usage(콘텐츠) | 단순 Q&A 넘어 회의·학습·개발·주간리뷰 응용방안(외부 PKM/LLM-wiki 리서치). weekly-review=금요일 주간리뷰 자동화(완료·미결·stale·우선순위→query 파일링) |
| 2026-08-01 | 스탬프 정규화·검증 | normalize-stamps.py(신설)·ingest-status.py(BAD 값검증) | raw 스탬프가 긴 frontmatter에 묻히거나 값 손상(예: `\bstale`) → 3필드를 맨 위로 정규화(본문 immutable 유지·body md5 대조) + ingest-status가 done/stale/pending 밖 값을 BAD로 노출. 외부감사(agy): 복구가능은 복구·garbage는 유지(done 강제 안 함)·단일줄 가정 문서화 |
| 2026-08-07 | raw immutable 범위 축소 | 편집 규칙(raw 수정 허용 조건·재인제스트 상시 허용) | immutable을 raw 전체에 적용하니 `raw/working/` 초안 정리조차 막힘 → immutable은 `ingest_status: done`인 소스에만 한정. done 아닌 파일은 자유 수정, 재인제스트는 언제든 요청 가능(done 본문 수정 시 승인+`stale` 강등) |
| 2026-08-28 | 녹음 감지 자동화 (감지만) | pending-recordings.py(신설)·wiki-status-check(run_skill 배선)·meeting-minutes/references/auto-watch.md | 08-21 녹음 4건이 일주일간 방치된 것을 아무도 몰랐음 → SessionStart가 미처리 녹음을 세어 알림. **전사·회의록은 자동화하지 않는다** — 백엔드 판정(로컬/외부)이 비가역이고 파일명·일일노트로 회의 성격을 알 수 없다(실제로 08-28 녹음은 메모가 `lll`뿐이었으나 내용은 심사 회의였다). 훅 메시지가 "사용자에게 회의 성격을 물어볼 것"을 명시해 모델의 임의 실행을 차단 |
| 2026-09-09 | MCP 서버(Node) P0 준비 | develop_docs/v0.8.6(PRD·DESIGN·리뷰·todo 작업계획 5단계)·tools/llmwiki-mcp 스캐폴딩·scope-expand.py/search.py 결정성(`dirs.sort()`·newline 고정)·픽스처 볼트+골든셋 56 | 위키 리트리벌을 Claude Code 밖(Codex·Gemini·agy·Cursor 등)에서도 쓰기 위해 MCP stdio 서버를 TS로 포팅하기로 결정(Node 런타임이 클라이언트에 보장됨). Python 정본은 랭킹 무변경, 순회 결정성만 수정(실볼트 20출력 diff 0). 실 볼트 출력 근거파일(todo/baseline·evidence)은 gitignore — 공개 저장소 콘텐츠 유출 방지 |
| 2026-09-09 | MCP 서버 P3 — 배포 준비·클라이언트 실측 | tools/llmwiki-mcp/README.md(370줄)·LICENSE·npm 메타·templates/mcp-client-guide.md+파생 4종(build.py)·저장소 README §5-5 | 8종 등록 스니펫을 `print-config` 실출력으로 문서화. **클라이언트 3종 실측**(Claude Code·Codex·agy)에서 codex 등록 명령의 실제 결함 발견(`-c startup_timeout_sec` 조합은 invalid transport 로 실패) 및 라우팅 준수율 측정 — Claude Code 준수, agy 는 스니펫 설치 후 준수. npm publish·태그는 사용자 승인 대기 |
| 2026-09-09 | MCP 서버 P2 — 도구 4개·보안·CLI | tools/llmwiki-mcp/src(tools·server·read·print-config·cli)·test/unit p2-*·ci.yml(read-only 가드) | 저수준 `Server`+수기 JSON Schema 채택(McpServer+zod 는 `$schema`·`additionalProperties` 자동 삽입 → 다중 클라이언트 호환 규칙 위반, 실측). 도구 wiki_search/expand/pack/read_page — 입력 런타임 정규화(문자열 terms·`[[slug]]`·`.md`), 상한, 200KB 절단, suggested_next 라우팅 힌트, alias 리다이렉트. 보안: walkMd·read_page realpath 경계(`path.relative`), symlink 스킵, 쓰기 API 0(CI 가드). CLI: `--selftest`·`print-config`(8 클라이언트, 출력만)·`--help`. zod 런타임 의존 제거 |
| 2026-09-09 | MCP 서버 P1 리트리벌 포팅 | tools/llmwiki-mcp/src(vault·graph·search·expand·bm25·pack·format·once·cli `--once`·pylower-table)·test/unit 19파일 176건·tests/parity.py·parity_fuzz.py·ci.yml parity 잡+pack 가드 | search/expand/rerank/pack 을 TS 로 포팅(비-rerank 바이트 동일, rerank 점수 ±0.05). Python 문자열 의미(strip/lower/count/len·`\s`·`\w`·코드포인트 정렬·`.1f` half-even·**Unicode 15.0 lower 테이블**)를 헬퍼로 재현. 픽스처 56/56·실볼트 20/20(digest 동일)·퍼징 420/420. 외부리뷰 2라운드(codex·agy)로 fmt1 거짓 tie·이중 BOM·NaN 허점·Unicode 버전 차이 검출·수정. 규칙: 리트리벌 규칙 변경은 Python·TS·픽스처 3점을 한 PR 에서 |
| 2026-09-09 | 훅 경로 절대화 | .claude/settings.json (SessionStart·PostToolUse 2건) | 훅이 `python3 .claude/...` 상대경로여서 셸 cwd가 하위 폴더로 바뀐 상태에서 PostToolUse가 실패(develop_docs 편집 중 실증). `"$CLAUDE_PROJECT_DIR"` 기준 절대경로로 변경 — 스크립트 자체는 `__file__`로 ROOT를 잡아 영향 없음 |
| 2026-08-13 | 녹음→회의록 파이프라인 | meeting-minutes 스킬(신설)·meeting-scribe 에이전트(신설)·wiki-ops 라우팅·apikey.py/transcribe.py | 일일노트에 녹음 첨부가 반복되는데 전사 수단이 없었음. 백엔드 2종(로컬 온디바이스 / OpenAI API)을 **회의 민감도로 분기** — 심사·인사·계약은 로컬 강제. 외부 전송은 프롬프트가 아닌 `--confirm-upload` 플래그로 코드 차단(규칙은 잊히지만 코드는 안 잊힘). API 키는 `~/Downloads/security.json` → macOS 키체인으로 이전 |
| 2026-09-10 | P4 착수 판정 + lex 1패스 최적화 | tools/llmwiki-mcp/src/{expand,once}.ts·test/unit/p4-12-lex-index.test.ts·test/perf/stage-bench.mjs·develop_docs/v0.8.6/todo/P4 | P1 코덱스 리뷰 #5 이월(lexScore 2회 계산) 처리 — `lexIndex` 를 호출당 1회 만들어 `lexicalSeeds`·`expand` 가 공유(**lex 단계 −49.8%**, 1,000p 125→63ms). **Python 정본은 무변경**이라 TS 만 구조가 다르다(2패스 vs 1패스) — 출력 동일성은 픽스처 패리티·퍼징·실볼트 digest(`9bcb72a0…` 불변)가 보증하고, 두 경로 대조 테스트를 따로 뒀다. 캐시 본체는 트리거 미관측(309p·buildGraph 28ms)으로 **미착수 유지** |
| 2026-09-10 | MCP 서버 P4 — 프로세스 내 mtime 캐시 | tools/llmwiki-mcp/src/cache.ts(신설)·graph/search/expand/bm25·test/unit/p4-cache.test.ts·test/perf/cache-bench.mjs·README·DESIGN §6 | 장수 프로세스인데 호출마다 볼트를 다시 읽던 것을 파일 신원 스냅샷(`lstat` 의 dev·ino·mode·size·mtimeNs·**ctimeNs**)으로 재사용 — **1,000p 195→26ms(-87%)**. ctime 은 userland 가 되돌릴 수 없어 `cp -p`·`rsync --times` 로 mtime 을 복원해도 낡은 적중이 없다(외부리뷰 codex·agy 1차 BLOCKER 4건 + codex 2차 BLOCKER 3건 판정·반영 — 2차의 'Windows ctime=생성 시각' 은 내 주석 오류를 인용한 것이라 공식 문서로 정정). 방금 수정된 파일이 있는 스냅샷은 저장뿐 아니라 적중도 금지. 3차 리뷰에서 codex·agy 모두 잔여 BLOCKER 0(agy '병합 가능'), 남은 MAJOR 2(누적 상한 사후 검사·전역 메모리 상한)도 반영. 순회·경계 검사는 캐시하지 않아 심볼릭 링크 스킵이 유지되고, 최근 2s 수정 파일이 있으면 스냅샷을 저장하지 않는다(타임스탬프 해상도 방어). term 무관 파생값(lex haystack·scoreText·dl)까지 캐시해야 ROI 가 난다는 것을 측정으로 확인(buildGraph 는 호출 비용의 29%). `LLMWIKI_CACHE=0` 으로 끌 수 있고 패리티는 on/off 양쪽에서 동일(digest 불변) |
| 2026-09-10 | MCP 서버 P4 배선 점검 | tools/llmwiki-mcp/src/{cache,cli}.ts·scripts/readonly-guard.py(신설)·.github/workflows/ci.yml·README·PRD §4·RELEASE-NOTES·P3/P4 체크리스트 | 배선 전수 점검에서 **CI 읽기 전용 가드가 실제로 실패**하는 것을 발견(`cache.ts` 의 fs default import) — 브랜치 미푸시로 CI 가 안 돌았고 가드가 ci.yml heredoc 에만 있어 로컬에서 못 잡았다 → 가드를 스크립트로 분리해 CI·로컬이 같은 파일을 쓰게 함. 캐시는 장수 서버에만 기본 on, `--once`·`--selftest` 는 기본 off(1회성 프로세스에선 stat 스캔만 더해지는 순수 비용 — 1,000p +7.7%, selftest 지표 의미 변화), `LLMWIKI_CACHE=1` 강제 on. `--help`·PRD·릴리즈 노트 버전 경계(P4 는 v0.11.0/npm 0.1.0 미포함)와 P3 체크리스트의 유령 ID(P3-31+~34+) 정리 |
| 2026-09-10 | MCP 서버 구조화 출력 기본 off (P4-27+) | tools/llmwiki-mcp/src/{server,cli}.ts·test/unit/p4-27-text-only-default.test.ts·README·DESIGN §3 | Claude Code 실클라이언트 E2E 에서 structuredContent JSON 이 모델에 그대로 넘어가고 우리 structuredContent 가 text 와 rows/pages 를 이중으로 담아 **모델 입력이 텍스트 대비 2~4배**임을 실측(pack 9.7KB→20KB) → P2 의 '항상 structuredContent' 결정을 뒤집어 **기본 텍스트만**, `LLMWIKI_STRUCTURED=1` 로 outputSchema+structuredContent opt-in(스펙상 둘은 함께). 텍스트는 작은 응답에서 두 모드 동일·outputSchema 검증은 opt-in 경로에 유지. 외부리뷰(codex·agy, BLOCKER 0) 반영 중 **P2 결함** 검출 — opt-in envelope 예산이 structuredContent 만 재 실제 전송량이 상한을 넘었다(341KB) → 전송 전체 측정 + 비례 보정 축소, 헬퍼 기본을 실제 서버와 같게 뒤집어 기본 모드 보안·상한 테스트 17건 신설 |
| 2026-09-11 | npm 패키지 이름 변경 → `obsidian-llmwiki-mcp` | tools/llmwiki-mcp/{package.json,package-lock.json,src/print-config.ts,README.md}·테스트 7파일·README·DESIGN·PRD·RELEASE-NOTES·P0/P3 문서 | 첫 publish 에서 npm 이 `llmwiki-mcp` 를 기존 `llm-wiki-mcp`(v0.2.0, 비슷한 용도의 별개 프로젝트)와 너무 비슷하다며 403 거부(구두점 제거 시 동일) → 사용자 결정으로 `obsidian-llmwiki-mcp`(구두점 변형 5종 포함 미사용 확인). 실행 명령(bin)은 `llmwiki-mcp` 유지 — bin 이 하나라 `npx -y obsidian-llmwiki-mcp` 가 그대로 실행한다. print-config 는 `PKG_NAME`/`BIN_NAME` 단일 소스로 바꾸고 package.json 과의 일치를 테스트로 고정. 과거 실측 기록(P3-25 롤백 로그 등)은 옛 이름 그대로 보존 |
| 2026-09-11 | npm 첫 공개 `obsidian-llmwiki-mcp@0.1.0` | develop_docs/v0.8.6(P3·P4 체크리스트·PRD·RELEASE-NOTES) | P0~P4 전부를 첫 공개에 포함(0.1.0/0.2.0 분할 안 함 — 공개 직후 기본값을 뒤집는 호환성 변경을 피함). 레지스트리 shasum 이 main `5c72f90` tarball 과 일치, 빈 캐시 `npx` 콜드 2.82s·웜 0.9s(P3-09). 2FA 는 사용자가 웹 인증으로 직접 실행. `git tag v0.11.0` 은 요청 대기 |
| 2026-09-11 | 태그 `v0.11.0` + GitHub Release, 머지 브랜치 정리 | develop_docs/v0.8.6(RELEASE-NOTES 확정·P3-23) | 릴리즈 노트를 확정한 PR 의 머지 커밋에 주석 태그(v0.10.0 관례)와 GitHub Release. 이번 작업으로 생긴 feature 브랜치 7개(원격·로컬) 삭제 — 이전부터 있던 머지된 브랜치 13개(`release/v0.8.x` 포함)는 유지 |

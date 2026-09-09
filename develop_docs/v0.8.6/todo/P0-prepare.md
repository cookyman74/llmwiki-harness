# P0 — 준비: 스캐폴딩 · Python 결정성 수정 · 픽스처 볼트

```
status: done               # not-started | in-progress | review | done
started: 2026-09-09
completed: 2026-09-09
external_review: done → review/P0-agy-2026-09-09.md (BLOCKER 0 · MAJOR 2 · MINOR 3, 전건 수용·반영)
```

- 근거: `../DESIGN.md §2`(패키지 구조), `§7`(픽스처·Python 수정), `§10`(열린 결정), `../PRD.md §2 ①`
- 선행 조건: 없음 (첫 단계). 설계서 §10 열린 결정 중 **npm 이름·`--once` 포함·Python 정렬 수정 포함**은 이 단계에서 확정한다.
- 완료 표시 방법: `00-README.md` "완료 표시 규칙" 을 따른다 (`- [x] … ✅ YYYY-MM-DD — 근거`).
- 브랜치: `feat/mcp-p0-prepare`. 근거 파일 중 `baseline/**` 는 실 볼트 콘텐츠를 담아 **로컬 전용(gitignore)** — `00-README.md` "근거 파일의 위치와 공개 범위".

## 체크리스트

### A. 결정 확정
- [x] P0-01 npm 패키지 이름 확정 — 기본 `llmwiki-mcp` (`npm view llmwiki-mcp` 로 미등록 재확인, 날짜 기록) ✅ 2026-09-09 — `npm view llmwiki-mcp version` 미등록 확인, DESIGN §10 기록
- [x] P0-02 `--once` CLI 모드 포함 확정 (패리티·디버그용, 설계서 §3.5) ✅ 2026-09-09 — DESIGN §10
- [x] P0-03 Python 디렉터리 순회 정렬 수정 포함 확정 (§7) ✅ 2026-09-09 — DESIGN §10
- [x] P0-04 `wiki_read_page` 전문 상한 200KB 절단 확정 ✅ 2026-09-09 — DESIGN §10
- [x] P0-05 확정 결과를 `../DESIGN.md §10` 표에 "확정 YYYY-MM-DD" 로 기록 ✅ 2026-09-09 — §10 표 4행에 "확정 2026-09-09(P0-0n)"

### B. 스캐폴딩 (`tools/llmwiki-mcp/`)
- [x] P0-06 `package.json` — `name`, `version: 0.1.0`, `bin: {"llmwiki-mcp": "dist/cli.js"}`, `files: ["dist", "README.md"]`, `engines.node: ">=20"`, `type: module` ✅ 2026-09-09 — tools/llmwiki-mcp/package.json
- [x] P0-07 의존성 2개만: `@modelcontextprotocol/sdk`, `zod` (devDeps: typescript, vitest 또는 node:test, eslint) ✅ 2026-09-09 — sdk 1.30.0, zod 4.5.4 (exact pin, package-lock.json). dev: typescript 6.0.3, vitest 5.0.0, eslint 10.10.0, typescript-eslint 8.70.0, @types/node 26.5.0
- [x] P0-08 `tsconfig.json` — target ES2022, module NodeNext, strict, outDir dist ✅ 2026-09-09 — TS6 는 `@types/*` 자동 포함을 안 하므로 `types: ["node"]` 추가(발견 사항, P1 주의)
- [x] P0-09 `src/` 빈 모듈 골격 생성 — vault.ts · graph.ts · search.ts · expand.ts · bm25.ts · pack.ts · read.ts · format.ts · server.ts · print-config.ts · cli.ts (설계서 §2 목록과 1:1) ✅ 2026-09-09 — 11개, cli.ts 는 `--version` 만 동작(0.1.0), 그 외 stderr 안내 + exit 2
- [x] P0-10 ESLint `no-console` 규칙 활성(stdout 순수성 — §3 공통), `npm run build`·`npm test` 스크립트 동작 확인 ✅ 2026-09-09 — lint 0건(probe 로 규칙 발동 확인), build OK, test 3 passed
- [x] P0-11 `.gitignore` 에 `tools/llmwiki-mcp/node_modules`, `dist` 추가 ✅ 2026-09-09 — 저장소 .gitignore, `git check-ignore -v` 확인

### C. Python 정본 결정성 수정 (랭킹 규칙 무변경)
- [x] P0-12 `scope-expand.py` `walk_md`: `os.walk` 루프에 `dirs.sort()` 추가 (파일은 이미 `sorted`) ✅ 2026-09-09 — baseline/P0-script-edits.diff
- [x] P0-13 `search.py` `files_mode`·`line_mode`: 동일하게 `dirs.sort()` 추가 ✅ 2026-09-09 — 동일 diff
- [x] P0-14 두 스크립트 stdout `reconfigure(encoding="utf-8", newline="\n")` — Windows CRLF 출력 방지 ✅ 2026-09-09 — 동일 diff. 골든셋 56파일에 `\r` 0건으로 검증
- [x] P0-15 **수정 전** 실볼트 대표 질의 5개 출력 저장 (`todo/baseline/P0-before-*.txt`) — 모드: `search --files`, `expand`, `expand --rerank 11`, `pack` ✅ 2026-09-09 — 20파일, 질의 목록 baseline/P0-queries.txt, md5 baseline/P0-md5-before.txt (로컬 전용)
- [x] P0-16 **수정 후** 동일 질의 실행 → `diff` 0건 확인, 결과를 `todo/baseline/P0-diff.txt` 에 기록 ✅ 2026-09-09 — 20쌍 전부 IDENTICAL, 총 diff 0줄
- [x] P0-17 `python3 tests/smoke.py` 통과 ✅ 2026-09-09 — 10 PASS, ALL PASS
- [x] P0-18 수정된 두 스크립트를 볼트 `.claude/skills/wiki-lint/scripts/` 에 설치(복사) — 볼트 SessionStart 훅 정상 확인 ✅ 2026-09-09 — 볼트 md5 = 수정본, wiki-status-check.py exit 0·JSON 정상

### D. 픽스처 볼트 (`tools/llmwiki-mcp/test/fixtures/vault/wiki/`)
콘텐츠는 전부 합성(실 볼트 내용 복사 금지). 설계서 §7 케이스를 전부 포함한다. **생성기 `make-fixture.py` 가 정본**(BOM·CRLF 바이트 보존), `--check` 로 디스크 동일성 검사.
- [x] P0-19 구조: `L2-episodic/` 5 · `L3-semantic/` 15 · `L4-procedural/` 2 · `moc/` 3 (≈25 페이지) ✅ 2026-09-09 — L2 5·L3 16·L4 2·moc 3 = 26 + wiki/ 밖 index.md·log.md(스코프 제외 검증)
- [x] P0-20 BOM 있는 파일 1개 이상 ✅ 2026-09-09 — concept-evaluation-harness.md (`ef bb bf` 확인)
- [x] P0-21 CRLF 줄바꿈 파일 1개 이상 (git이 LF로 바꾸지 않도록 `.gitattributes` 에 해당 파일 `-text` 지정) ✅ 2026-09-09 — concept-prompt-caching-crlf.md (CR 17줄), .gitattributes `**/*-crlf.md -text`, `git check-attr` text: unset
- [x] P0-22 별칭(aliases)으로만 링크되는 페이지 쌍 ✅ 2026-09-09 — concept-linker `[[별칭페이지]]`·`[[AliasName|표시]]` → concept-alias-target (q09 expand 도달 확인)
- [x] P0-23 이미지 임베드 `![[…]]` 포함 페이지 (링크 제외 검증) ✅ 2026-09-09 — entity-northwind-team
- [x] P0-24 코드펜스 안 가짜 관계 `- uses :: [[x]]` (관계 추출 제외 검증) ✅ 2026-09-09 — concept-reranking, q02/q12 pack 에 `fake-target-in-fence` 미출력
- [x] P0-25 코드펜스 안 `- claim:: …` (claims는 **포함**되어야 함 — #18 비대칭) ✅ 2026-09-09 — 같은 페이지, pack 에 "펜스 안 클레임…" 포함 확인
- [x] P0-26 이모지 등 non-BMP 문자 본문 (dl 코드포인트 검증) + non-BMP 문자 포함 slug 2개 (정렬 검증) ✅ 2026-09-09 — concept-emoji-notes 🦀🚀, slug `zz-🦀-crab`·`zz-￦-won`; q06 expand 에서 Python 코드포인트 순(￦ → 🦀) 고정
- [x] P0-27 `claim::` 없는 concept 페이지 (첫 실문단 요약 경로) ✅ 2026-09-09 — entity-northwind-team (헤더·임베드·인용·표 건너뛰고 첫 문단 요약 확인)
- [x] P0-28 `status: stale` + `superseded_by` 쌍 ✅ 2026-09-09 — fact-latency-budget-old ↔ fact-latency-budget, q07 pack 헤더 `· stale`
- [x] P0-29 중복 slug — 디렉터리가 다른 동명 파일 2개 (마지막 승 규칙) ✅ 2026-09-09 — L2-episodic/dup-note.md vs L3-semantic/dup-note.md, q10 pack 에 L3 버전 출력
- [x] P0-30 큰 MoC — 멤버 10개 이상 (MEMBER_K=6 소프트 컷 검증) ✅ 2026-09-09 — search-moc 멤버 12. moc tier 는 q05(5)·q09(5)·q14(3) 등에서 발생. **의미 확인**: MoC 가 seed 이면 멤버는 1hop(tier=min) — q13 으로 고정
- [x] P0-31 한국어 관계 술어 `- 사용함 :: [[x]]` (JS `\w` 함정 검증) ✅ 2026-09-09 — entity-northwind-search (들여쓴 관계 줄 포함)
- [x] P0-32 심볼릭 링크는 두지 않음을 확인 (`find … -type l` 0건) ✅ 2026-09-09
- [x] P0-33 픽스처 질의 12개(→**14개**, 리뷰 MINOR 반영) 확정 → `test/fixtures/queries.json` (한국어·영문·혼합·**대문자**·미매치 포함, 각 질의에 기대 모드 표기) ✅ 2026-09-09 — **14개**로 확정(골든셋 검증 중 type 기본값(#5) 경로 미실행 발견 → q14 추가, MoC-as-seed 의미 고정 → q13 추가). 모드 인자는 `defaults` 에 고정
- [x] P0-34 Python 정본으로 12(→**14**)질의 × 4모드 = 56 기대 출력 생성 → `test/fixtures/expected/` (패리티 골든셋. rerank 모드는 점수 열 허용오차 대상임을 README에 명시) ✅ 2026-09-09 — `gen-expected.py` 로 14×4 = 56파일 생성, `--check` 재현 OK. 허용오차 규약은 queries.json `_doc` 에 명시(패키지 README 는 P3)

### 추가 항목 (P0 진행 중 발견)
- [x] P0-35+ 실 볼트 출력을 담는 `todo/baseline/**`·`todo/evidence/**` 를 `.gitignore` 로 커밋 차단(.gitkeep 만 추적) — 공개 저장소 콘텐츠 유출 방지 ✅ 2026-09-09 — 저장소 .gitignore, `git check-ignore` 확인, 00-README 규칙 추가
- [x] P0-36+ 골든셋 생성기 `gen-expected.py`(`--check` 포함) 를 픽스처 옆에 두어 P1 `parity.py` 가 동일 명령 정의를 재사용하게 함 ✅ 2026-09-09
- [x] P0-37+ (리뷰 MAJOR-1) `tsconfig.json` 을 전체 타입검사용(src+test, noEmit) 으로, 빌드는 `tsconfig.build.json`(src만) 으로 분리. `typecheck`·`check` 스크립트 추가, `lint` 는 `eslint src test`, eslint `files` 에 test 포함 ✅ 2026-09-09 — `npm run check` 통과(lint·typecheck·test 3·build 11)
- [x] P0-38+ (리뷰 MAJOR-2) `clean` 스크립트 작은따옴표 중첩 → 이스케이프된 큰따옴표(Windows cmd 호환) ✅ 2026-09-09 — 실행 확인
- [x] P0-39+ (리뷰 MINOR-2) `do_pack` 헤더 type 기본값 `?` vs graph/search 의 dirname 비대칭을 DESIGN §4 #5 에 명기, P1-42b 항목 추가 ✅ 2026-09-09
- [x] P0-40+ (리뷰 MINOR-3) P1 `parity.py` 병렬 실행 요구를 P1-42 와 DESIGN §7 에 반영 ✅ 2026-09-09

## 산출물
- `tools/llmwiki-mcp/` 골격(package.json·lock·tsconfig·eslint·src 11 스텁·test/unit/scaffold.test.ts·README 플레이스홀더)
- `tools/llmwiki-mcp/test/fixtures/{make-fixture.py, vault/, queries.json, gen-expected.py, expected/(56)}`
- 수정된 `search.py`·`scope-expand.py` (+ 볼트 설치)
- 로컬 전용: `todo/baseline/P0-before-*.txt`(20)·`P0-after-*.txt`(20)·`P0-diff.txt`·`P0-queries.txt`·`P0-md5-*.txt`·`P0-script-edits.diff`
- 저장소 `.gitignore`(node_modules·dist·baseline·evidence)·`.gitattributes`(CRLF 픽스처 예외)

## 완료 기준 (DoD)
- [x] A~D 전 항목 완료 또는 사유 명시 ✅ 2026-09-09
- [x] `tests/smoke.py` ALL PASS, 실볼트 수정 전후 diff 0건 ✅ 2026-09-09
- [x] `npm run build` 성공(빈 모듈), `npm pack --dry-run` 에 `test/`·픽스처가 포함되지 않음 ✅ 2026-09-09 — 13파일(dist 11·package.json·README.md)
- [x] 외부리뷰 완료 (아래) ✅ 2026-09-09 — review/P0-agy-2026-09-09.md, 총평 "조건부 P1 진입 승인" → MAJOR 2건 즉시 보완 후 재검증 통과

## 외부리뷰 (단계 종료 시 필수)
- 대상: 수정된 Python 2파일 diff, 픽스처 볼트 전체, `queries.json`, `package.json`
- 관점: ① Python 수정이 랭킹에 영향 없는가(정렬만인가) ② 픽스처가 설계서 §7 케이스를 빠짐없이 덮는가, 실 콘텐츠 유출은 없는가 ③ 기대 출력 골든셋이 Python 정본에서 재현 가능한가 ④ package.json `files` 화이트리스트가 콘텐츠 비유출을 보장하는가
- 절차: `00-README.md` "외부리뷰 규칙". 프롬프트 `review/P0-prompt.txt`, 결과 `review/P0-agy-YYYY-MM-DD.md`

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| 1 | MAJOR | tsconfig `include: [src]`·`eslint src` 라 test/ 코드가 타입검사·린트 사각지대 | 수용 | tsconfig.json(src+test, noEmit) + tsconfig.build.json, scripts typecheck/check, eslint files — P0-37+ |
| 2 | MAJOR | `clean` 스크립트 작은따옴표 중첩 → Windows cmd 파싱 실패 | 수용 | package.json clean — P0-38+ |
| 3 | MINOR | 질의 수 12 표기 잔존(P0-33/34 제목, DESIGN §7 `QUERIES(12)`) | 수용 | 제목 "12(→14)" 주석, DESIGN §7 `QUERIES(14)` |
| 4 | MINOR | `do_pack` type 기본값 `?` vs graph/search dirname 비대칭 미문서화 → P1 패리티 실패 위험 | 수용 | DESIGN §4 #5, P1-42b — P0-39+ |
| 5 | MINOR | gen-expected 직렬 56회 ≈7s, P1 parity 112회면 느림 | 수용(P1 요구사항으로) | P1-42, DESIGN §7 — P0-40+ |

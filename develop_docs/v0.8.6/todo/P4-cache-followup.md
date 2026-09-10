# P4 — (후속) 프로세스 내 mtime 캐시 v1.1

```
status: in-progress        # not-started | in-progress | review | done — **캐시 본체(P4-02~P4-11)는 착수 조건 미충족으로 미착수(YAGNI)**.
                           # 이번에 수행한 것은 P1 에서 이월된 P4-12+(캐시와 무관·출력 무변경)와 그 검증 하네스뿐이다.
started: 2026-09-10
completed:
external_review:           # pending | done → review/P4-agy-YYYY-MM-DD.md — 캐시 착수 시 수행. P4-12+ 는 P3 브랜치 리뷰 대상에 포함
branch: feat/mcp-p4-lex-index (base: feat/mcp-p3-release, PR #22 위에 스택) — 캐시 착수 시 별도 브랜치
```

- 근거: `../DESIGN.md §6`(성능), `../PRD.md §4 비목표`("캐시는 v1 에서 안 함 → v1.1")
- 선행 조건: **P3 done (v0.11.0 릴리즈)** 그리고 다음 중 하나가 관측될 때만 착수 — ① 실볼트 1,000 페이지 근접 ② 호출당 buildGraph 가 1s 초과 ③ 사용자가 지연을 체감. 관측 없으면 이 단계는 **열지 않는다(YAGNI)**.
  - **2026-09-10 판정: ①②③ 전부 미해당** → 캐시 미착수 유지. 근거 `todo/baseline/P4-trigger.txt`(P4-01).
- 완료 표시 방법: `00-README.md` 규칙

## P0~P3 교훈 반영 (이 단계에 적용하는 규칙)

앞 단계에서 실제로 대가를 치르고 얻은 것만 적는다. 캐시를 열 때 이 규칙을 먼저 읽는다.

1. **문자열 리뷰는 실행을 대신하지 못한다.** P3 에서 codex 등록 명령이 리뷰 3라운드를 통과하고 실행에서 죽었다(`-c` 조합 → invalid transport). → 캐시 항목은 "코드가 그렇게 보인다"가 아니라 **파일을 실제로 바꾸고 다음 호출 결과를 확인**하는 테스트로만 완료 표시한다(P4-07).
2. **측정 조건을 지표 문구와 일치시킨다.** P3 라우팅은 지표가 "규칙 스니펫 없는 상태"인데 15회 측정은 전부 스니펫 설치 상태여서 지표를 입증하지 못했다. → P4 의 모든 측정은 `on/off·페이지 수·runs·warmup·측정 지점(프로세스 wall vs 인프로세스)`을 근거 파일 첫 줄에 적는다.
3. **미달을 `[x]` 로 적지 않는다.** P3 외부리뷰 BLOCKER 5건 중 3건이 이 유형이었다. → 조건 미충족이면 `[ ] ⏸ 사유`, 판정이 바뀌면 근거 파일 경로를 함께 남긴다.
4. **"미달"의 원인이 대상이 아니라 실행 조건일 수 있다.** Codex 라우팅 미달의 실제 원인은 `codex exec` 의 기본 `approval: never` 였다. → 캐시 성능이 기대만 못 하면 캐시 로직을 고치기 전에 **측정 하네스**(warmup·프로세스 경계·OS 파일캐시)부터 의심한다. 실볼트 `--rerank 0` 구간에서 12ms 절감이 프로세스 노이즈(±30ms)에 묻힌 것이 이번 실례다.
5. **정본과의 구조 분기는 패리티로만 지탱된다.** P4-12+ 로 TS 의 lex 경로가 Python 정본과 구조가 달라졌다(2패스→1패스). → 리트리벌 규칙을 바꾸는 변경은 `CLAUDE.md` 동기 규칙대로 Python·TS·픽스처 3점을 한 PR 에서 고치고, **구조만 다르고 출력이 같은 변경은 픽스처·퍼징·실볼트 digest 3중으로 증명**한다(P4-16+).
6. **보안·상한 가드는 최적화의 사각지대다.** P2 에서 읽기 전용 가드가 별칭 import 로 우회됐고(3차 BLOCKER), TOCTOU·심볼릭 링크 경계가 두 번 뚫렸다. → 캐시는 `walkMd` 경계 검사·`O_NOFOLLOW` 뒤에 놓이며, 캐시 적중 경로가 이 검사들을 건너뛰지 않는지 별도 테스트(P4-10)로 고정한다.
7. **환경 제약은 계획 시점에 확인한다.** P3 는 필수 5종 중 2종을 환경 부재로 검증하지 못한 채 지표를 세웠다. → P4 의 OneDrive·FAT/exFAT mtime 정밀도 항목은 **해당 환경을 실제로 만들 수 있는지 먼저 확인**하고, 불가하면 착수 전에 항목을 조정한다.

## 체크리스트

### A. 착수 판정
- [x] P4-01 착수 사유 기록(위 ①②③ 중 무엇, 측정값) — `todo/baseline/P4-trigger.txt` ✅ 2026-09-10 — **판정: 미착수(트리거 미관측)**. ① 309/1,000 페이지(30.9%) ② buildGraph median **18.6ms**(인프로세스)·28ms(`--selftest`) — 목표 1s 대비 ~35배 여유 ③ 지연 체감 보고 없음. 합성 1,000p 에서도 호출 합계 183ms(목표 <3s 의 6%). 근거 `todo/baseline/P4-trigger.txt`

### B. 설계
- [ ] P4-02 캐시 키 = 전 파일 `(relpath, mtimeMs, size)` 스냅샷. 호출 시 `readdir+stat` 스캔으로 변경 감지
- [ ] P4-03 변경 파일만 재파싱, 그래프(인링크 포함)는 통째 재구성 — 부분 갱신 금지(정확성 우선)
- [ ] P4-04 캐시 무효화 조건 — 파일 추가·삭제·mtime·size 변화, `--root` 변경. 캐시 크기 상한(페이지 수 기준) 없음, 프로세스 종료 시 소멸(디스크 캐시 없음)
- [ ] P4-05 `LLMWIKI_CACHE=0` 으로 끌 수 있음(패리티·디버그)

### C. 구현·테스트
- [ ] P4-06 `src/cache.ts` 구현, `buildGraph` 앞단에 투명 삽입
- [ ] P4-07 단위 — 파일 수정/추가/삭제 후 다음 호출에서 반영, OneDrive 지연(mtime 만 변경·내용 동일) 케이스
- [ ] P4-08 패리티 — `tests/parity.py` 를 캐시 on/off 양쪽으로 실행, 전건 동일. 연속 호출(같은 프로세스) 시나리오 추가
- [ ] P4-09 성능 — 1,000 페이지 합성 볼트에서 2회차 호출 <100ms, stat 스캔 비용 기록 `todo/baseline/P4-perf.txt`
- [ ] P4-10 심볼릭 링크 스킵 규칙(P2-17) 이 캐시 경로에서도 유지되는지 테스트

- [x] P4-12+ (P1 코덱스 리뷰 #5 이월) lexScore 중복 계산 제거 — `lexicalSeeds` 가 distinct 캐시를 반환해 `expand` 가 재사용, BM25 `scoreText`·cpLen 도 그래프 빌드 시 1회 계산. **출력 무변경**(패리티 전건 유지가 조건). Python 정본은 그대로 둔다 ✅ 2026-09-10 — `src/expand.ts` 에 `LexIndex`·`lexIndex(G, terms)` 신설, `lexicalSeeds`/`expand` 가 **선택 인자** `idx` 로 재사용(미전달 시 기존 동작 그대로, 부분 인덱스면 누락 노드만 그 자리에서 계산). `src/once.ts expandData` 가 호출당 1회 생성해 둘에 전달. **lex 단계 −49.8%**(309p 24.72→12.42ms · 1,000p 125.26→62.86ms · 2,000p 254.61→128.19ms). 출력 무변경 3중 검증: 픽스처 패리티 0/56 FAIL·골든 DRIFT 0 · 퍼징 200/200×2 seed · 실볼트 0/20 FAIL 3회 반복 **digest `9bcb72a0a91edc08` = P1-67+ 가 기록한 변경 이전 값과 동일**. `npm run check` 40파일 551건 통과, `npm pack` 19파일 무변동. 근거 `todo/baseline/P4-perf.txt`
      ↳ **BM25 부분은 이미 충족돼 코드 변경이 없다**(추측 아닌 소스 확인): `bm25Rank` 는 호출당 `scoreText`·`cpLen` 을 노드별 1회만 돌리고(`texts`·`dlOf` 맵, P1-69+ 에서 처리), 프로덕션 경로에서 `bm25Rank` 는 요청당 1회만 불린다(`src/once.ts:99` 가 유일한 호출부). 호출을 넘는 재사용은 캐시(P4-13+) 없이는 불가능하다
- [x] P4-14+ 단계별 계측 하네스 `test/perf/stage-bench.mjs` — buildGraph·lex(legacy/shared)·bm25 를 **인프로세스**로 분리 측정(median of 30, warmup 5)하고 두 경로의 결과 동일성까지 출력. 숫자만 출력해 baseline 에 그대로 붙여도 콘텐츠가 새지 않는다 ✅ 2026-09-10 — 프로세스 wall(`bench.py`)은 node 부팅 ~145ms·OneDrive IO 에 신호가 묻혀 12ms 절감을 판정할 수 없었다(교훈 4). eslint 에 `test/perf/**/*.mjs` Node 전역 블록 추가
- [x] P4-15+ 등가성 회귀 테스트 `test/unit/p4-12-lex-index.test.ts` 6건 — `lexIndex` 값 = 노드별 `lexScore`, `lexicalSeeds`/`expand` 가 idx 유무와 무관하게 동일, 렌더 텍스트 바이트 동일, **부분 인덱스·빈 인덱스** 경계. term 집합 8종(무매치·빈 목록·중복·비ASCII·alias 포함) ✅ 2026-09-10 — 골든·패리티는 실행 경로 하나만 보므로 두 경로 대조는 별도 테스트가 필요하다
- [x] P4-16+ 정본과의 구조 분기 기록 — Python `scope-expand.py` 는 `lexical_seeds`·`expand` 가 각자 `lex_score` 를 돌리고(2패스), TS 는 1패스다. 정본은 **수정하지 않는다**(P1 리뷰 판정 유지). 분기를 `src/expand.ts` 주석과 `CLAUDE.md` 변경 이력에 남기고, 보증은 패리티 3종이 진다 ✅ 2026-09-10
- [ ] P4-13+ (P4-01 측정 결과 반영) **캐시 범위 재정의** — 현행 P4-02~P4-04 는 `buildGraph` 만 캐시하지만, 1,000 페이지 실측 분해에서 buildGraph 는 호출 비용의 **29%**(52ms/183ms)뿐이다(lex 34% + bm25 37%). 노드별 파생 산출물 중 **term 과 무관한 것**(lex haystack `pyLower(text+"\n"+aliases)`, bm25 `scoreText`, `dl`)을 캐시 엔트리에 함께 실어야 ROI 가 난다. 착수 시 P4-02·P4-03 을 이 범위로 고쳐 쓴다 — 단, 파생값은 **원본 파일 변경 시 함께 무효화**되어야 하므로 무효화 단위를 파일→(노드+파생)으로 정의할 것
- [ ] P4-18+ 착수 트리거 감시 — 위키 lint·주간리뷰 때 `node tools/llmwiki-mcp/dist/cli.js --selftest --root <VAULT>` 의 `pages`·`buildGraph_ms` 를 확인해 ①② 근접 여부만 본다(현재 309p·28ms). 근접하면 P4-01 을 갱신하고 캐시를 연다

### D. 배포
- [ ] P4-11 npm `0.2.0` publish, README 성능 절 갱신, `CLAUDE.md` 변경 이력 행 — **선행: P3-08 의 `0.1.0` publish**(승인 대기). 0.1.0 이 나가기 전에는 0.2.0 을 논하지 않는다
- [x] P4-17+ (P4-12+ 몫) `CLAUDE.md` 변경 이력 행 추가 — 패키지 배포 없이 저장소에만 반영되는 변경이므로 P4-11 과 분리해 지금 기록 ✅ 2026-09-10

## 산출물
- `src/cache.ts`, 테스트, `P4-trigger.txt`, `P4-perf.txt`, npm 0.2.0
- (2026-09-10 시점 실제 산출) `src/expand.ts`(`lexIndex`)·`src/once.ts`, `test/unit/p4-12-lex-index.test.ts`, `test/perf/stage-bench.mjs`, `todo/baseline/P4-trigger.txt`·`P4-perf.txt`

## 완료 기준 (DoD)
- [ ] 캐시 on/off 패리티 전건 동일 — ⏸ 캐시 미착수(P4-01 판정)
- [ ] 성능 목표 달성 기록 — ⏸ 캐시 미착수. 현 시점 측정치는 `P4-trigger.txt` 에 기록(목표 대비 여유 확인용)
- [ ] 외부리뷰 완료 — ⏸ 캐시 착수 시. P4-12+ 변경분은 P3 스택 브랜치의 리뷰 범위에 포함
- [x] (이월분) P4-12+ 출력 무변경 완료 ✅ 2026-09-10 — 픽스처 패리티·퍼징 2 seed·실볼트 digest 동일·단위 551건, 세 볼트에서 `identical_output=true`

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/cache.ts`, 관련 테스트, 성능 기록
- 관점: ① 무효화 누락(stale 결과 반환) 경로 ② OneDrive 온디맨드 파일·mtime 정밀도(FAT/exFAT 2s) 함정 ③ 메모리 상한 부재의 위험 ④ 캐시가 보안 규칙(심볼릭 링크·경로 제한)을 우회하는 경로
- 관점(추가, 2026-09-10) ⑤ **정본 구조 분기**(P4-12+)가 패리티만으로 충분히 지탱되는가 — 픽스처가 닿지 않는 입력(부분 인덱스·빈 terms·중복 slug 볼트)에서 두 경로가 갈릴 여지 ⑥ 파생값 캐시(P4-13+)가 원본 무효화와 어긋나 **term 무관 파생만 낡는** 경로
- 절차: `00-README.md` 규칙. 프롬프트 `review/P4-prompt.txt`, 결과 `review/P4-agy-YYYY-MM-DD.md`

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| | | | | |

# P4 — (후속) 프로세스 내 mtime 캐시 v1.1

```
status: done               # not-started | in-progress | review | done — 캐시 구현·검증 완료(P4-02~P4-10·P4-13+), **외부리뷰 3라운드 — 3차에서 codex·agy 모두 잔여 BLOCKER 0**.
                           # **P4-11(npm 0.2.0 publish)만 P3-08 의 0.1.0 publish 승인에 막혀 있다.**
                           # 착수 판정(P4-01)은 트리거 미관측이었으나 사용자 지시로 캐시를 열었다 — 그 경위를 P4-01 에 남긴다.
started: 2026-09-10
completed: 2026-09-10
external_review: 1차 done → review/P4-agy-2026-09-10.md(병합 불가, BLOCKER 2·MAJOR 3·MINOR 2) · review/P4-codex-2026-09-10.md(병합 불가, BLOCKER 2·MAJOR 6·MINOR 2) — 전건 판정·반영 · 2차 codex → review/P4-codex-r2-2026-09-10.md(병합 불가, BLOCKER 3·MAJOR 3·MINOR 2) — 전건 판정·반영 · 2차 agy **미수행**(agy CLI 인증 확인 실패 — 계정 프로필 조회 오류, 코드와 무관. 3차에 포함) · 3차 codex → review/P4-codex-r3-2026-09-10.md(BLOCKER 0·MAJOR 2·MINOR 2) · 3차 agy → review/P4-agy-r3-2026-09-10.md(**병합 가능**, BLOCKER 0·MAJOR 0·MINOR 2) — 전건 판정·반영 → **done**
branch: feat/mcp-p4-lex-index (base: feat/mcp-p3-release, PR #22 위에 스택) — 캐시 착수 시 별도 브랜치
```

- 근거: `../DESIGN.md §6`(성능), `../PRD.md §4 비목표`("캐시는 v1 에서 안 함 → v1.1")
- 선행 조건: **P3 done (v0.11.0 릴리즈)** 그리고 다음 중 하나가 관측될 때만 착수 — ① 실볼트 1,000 페이지 근접 ② 호출당 buildGraph 가 1s 초과 ③ 사용자가 지연을 체감. 관측 없으면 이 단계는 **열지 않는다(YAGNI)**.
  - **2026-09-10 판정: ①②③ 전부 미해당**(근거 `todo/baseline/P4-trigger.txt`). 그럼에도 **사용자 지시로 착수**했다 — 게이트를 '측정으로 확인한 뒤 사람이 연다'로 운용한 것이고, 판정 기록은 그대로 남긴다(교훈 3: 미달을 지우지 않는다).
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
- [x] P4-02 캐시 키 = 전 파일 `(relpath, mtimeMs, size)` 스냅샷. 호출 시 `readdir+stat` 스캔으로 변경 감지 ✅ 2026-09-10 — `src/cache.ts snapshot()`: `walkMd`(경계 검사 포함) 결과에 **`lstat`**(링크 미추적)을 병렬로 붙여 볼트 realpath + 파일별 `(경로, dev, ino, mode, size, mtimeNs, ctimeNs)` 를 이어붙인 키(외부리뷰 1차로 `(relpath, mtimeMs, size)` 에서 확장 — P4-19+). stat 실패·비정규 파일은 `?` 로 남아 **항상 미스**가 된다. 스캔 비용 실측 309p 5.2ms·1,000p 17.2ms
- [x] P4-03 변경 파일만 재파싱, 그래프(인링크 포함)는 통째 재구성 — 부분 갱신 금지(정확성 우선) ✅ 2026-09-10 — `readTexts()` 가 **안정 스냅샷에서 신원(`FileId`)이 같은** 파일의 본문만 재사용하고(불안정 스냅샷이면 전량 재독 — 2차 반영) 나머지는 `read()`(O_NOFOLLOW 유지). 그래프는 `assemble()` 로 **통째 재구성** — 링크 정규화·인링크는 부분 갱신하지 않는다. 누적 바이트 예산(`MAX_TOTAL_BYTES`)은 **캐시 적중분까지 세어** 캐시 유무로 상한 판정이 달라지지 않게 했다
- [x] P4-04 캐시 무효화 조건 — 파일 추가·삭제·mtime·size 변화, `--root` 변경. 캐시 크기 상한(페이지 수 기준) 없음, 프로세스 종료 시 소멸(디스크 캐시 없음) ✅ 2026-09-10 — 추가·삭제는 키의 파일 목록이 달라져 미스(삭제 파일 텍스트는 `c.texts` 대입 교체로 함께 사라짐), `--root` 는 root 별 캐시(`Map`, 최대 4개, LRU — 1·2차 반영)라 전환해도 서로 섞이지 않는다. 디스크 캐시 없음. **추가 규칙**: 스냅샷에 `[-5s, 2s)` 창 안 수정 파일이 있으면 '불안정' — 저장도 기존 캐시 사용도 하지 않는다(1·2차 반영) — FAT/exFAT·클라우드 동기 폴더의 타임스탬프 해상도 안에서 크기까지 같은 수정은 스냅샷으로 구분할 수 없기 때문. 파생 메모는 누적 128MiB(`DERIVED_BUDGET_BYTES`) 상한
- [x] P4-05 `LLMWIKI_CACHE=0` 으로 끌 수 있음(패리티·디버그) ✅ 2026-09-10 — 끄면 stat 스캔조차 하지 않고 v1 경로(`readAll`)로 간다. 파생 메모도 저장하지 않는다. README(Env 줄·CLI 절·한계)와 DESIGN §6 에 기재 · **배선 점검(2026-09-10)**: 미지정 시 서버는 on·`--once`/`--selftest` 는 off, `=1` 로 강제 on 추가(P4-25+)

### C. 구현·테스트
- [x] P4-06 `src/cache.ts` 구현, `buildGraph` 앞단에 투명 삽입 ✅ 2026-09-10 — `buildGraph` 는 `walkMd` → `snapshot` → 적중 시 **같은 Graph 객체** 반환, 미스 시 `assemble()`. `search.ts filesMode` 도 같은 텍스트 캐시를 쓴다. 호출부(`once.ts`·`read.ts`·`cli.ts`·`tools.ts`)는 **무변경** — 캐시는 전적으로 투명하다
- [x] P4-07 단위 — 파일 수정/추가/삭제 후 다음 호출에서 반영, OneDrive 지연(mtime 만 변경·내용 동일) 케이스 ✅ 2026-09-10 — `test/unit/p4-cache.test.ts` 25건(최초 10 + 1차 회귀 6 + 2차 회귀 5 + 3차 회귀 4): 적중 시 동일 객체 · 수정 반영 · 추가/삭제 반영(인링크 재생성·삭제 파일 캐시 제거) · mtime 만 변경(내용 동일)은 재구성하되 결과 동일 · **타임스탬프 해상도 안의 수정**(같은 크기·같은 mtime 으로 내용 교체)에서도 새 내용을 본다 · `--root` 전환 · on/off 동일
- [x] P4-08 패리티 — `tests/parity.py` 를 캐시 on/off 양쪽으로 실행, 전건 동일. 연속 호출(같은 프로세스) 시나리오 추가 ✅ 2026-09-10 — 픽스처 **0/56 FAIL·DRIFT 0 (on·off 양쪽)** · 퍼징 200/200 (on·off) · 실볼트 **0/20 FAIL, digest `9bcb72a0a91edc08`**(on 2회·off 1회 전부 동일 — P1-67+ 의 캐시 이전 값과도 동일). 연속 호출은 CLI 로는 잴 수 없어(프로세스마다 캐시가 새로 생김) 인프로세스 테스트로 넣었다(P4-07 의 on/off 케이스가 같은 프로세스에서 3라운드 반복)
- [x] P4-09 성능 — 1,000 페이지 합성 볼트에서 2회차 호출 <100ms, stat 스캔 비용 기록 `todo/baseline/P4-perf.txt` ✅ 2026-09-10 — `test/perf/cache-bench.mjs`(인프로세스 median of 10): **최신 — 1,000p 정확히 2회차 26.6ms**(3차 반영 후, off 164.3 / 2차 반영 후 24.5ms)(목표 <100ms 충족, -85%) · 309p off 42.5 → 2회차 **8.3ms**. warm 의 고정 비용은 walk+lstat 스캔(309p 5.2 · 1,000p 17.2ms). 이력: 최초 기록 24.0ms 는 'warm 반복 median' 이었고 1차 리뷰(codex M5)로 '정확히 2회차' 측정으로 바꿨다 — warm 시간의 70~75%가 스캔이다. `identical_output=true`
- [x] P4-10 심볼릭 링크 스킵 규칙(P2-17) 이 캐시 경로에서도 유지되는지 테스트 ✅ 2026-09-10 — 설계상 순회는 **캐시하지 않는다**(캐시는 `walkMd` 뒤에 붙는다). 테스트 2건: 캐시 적중 상태에서 경계 밖 파일로 링크를 넣어도 노드가 늘지 않고 카나리 문자열이 그래프에 없다 · 실제 파일을 링크로 교체하면 목록이 바뀌어 재구성되고 외부 내용이 실리지 않는다. 링크 생성 권한이 없는 환경에서는 사유를 남기고 건너뛴다

- [x] P4-12+ (P1 코덱스 리뷰 #5 이월) lexScore 중복 계산 제거 — `lexicalSeeds` 가 distinct 캐시를 반환해 `expand` 가 재사용, BM25 `scoreText`·cpLen 도 그래프 빌드 시 1회 계산. **출력 무변경**(패리티 전건 유지가 조건). Python 정본은 그대로 둔다 ✅ 2026-09-10 — `src/expand.ts` 에 `LexIndex`·`lexIndex(G, terms)` 신설, `lexicalSeeds`/`expand` 가 **선택 인자** `idx` 로 재사용(미전달 시 기존 동작 그대로, 부분 인덱스면 누락 노드만 그 자리에서 계산). `src/once.ts expandData` 가 호출당 1회 생성해 둘에 전달. **lex 단계 −49.8%**(309p 24.72→12.42ms · 1,000p 125.26→62.86ms · 2,000p 254.61→128.19ms). 출력 무변경 3중 검증: 픽스처 패리티 0/56 FAIL·골든 DRIFT 0 · 퍼징 200/200×2 seed · 실볼트 0/20 FAIL 3회 반복 **digest `9bcb72a0a91edc08` = P1-67+ 가 기록한 변경 이전 값과 동일**. `npm run check` 40파일 551건 통과, `npm pack` 19파일 무변동. 근거 `todo/baseline/P4-perf.txt`
      ↳ **BM25 부분은 이미 충족돼 코드 변경이 없다**(추측 아닌 소스 확인): `bm25Rank` 는 호출당 `scoreText`·`cpLen` 을 노드별 1회만 돌리고(`texts`·`dlOf` 맵, P1-69+ 에서 처리), 프로덕션 경로에서 `bm25Rank` 는 요청당 1회만 불린다(`src/once.ts:99` 가 유일한 호출부). 호출을 넘는 재사용은 캐시(P4-13+) 없이는 불가능하다
- [x] P4-14+ 단계별 계측 하네스 `test/perf/stage-bench.mjs` — buildGraph·lex(legacy/shared)·bm25 를 **인프로세스**로 분리 측정(median of 30, warmup 5)하고 두 경로의 결과 동일성까지 출력. 숫자만 출력해 baseline 에 그대로 붙여도 콘텐츠가 새지 않는다 ✅ 2026-09-10 — 프로세스 wall(`bench.py`)은 node 부팅 ~145ms·OneDrive IO 에 신호가 묻혀 12ms 절감을 판정할 수 없었다(교훈 4). eslint 에 `test/perf/**/*.mjs` Node 전역 블록 추가
- [x] P4-15+ 등가성 회귀 테스트 `test/unit/p4-12-lex-index.test.ts` 6건 — `lexIndex` 값 = 노드별 `lexScore`, `lexicalSeeds`/`expand` 가 idx 유무와 무관하게 동일, 렌더 텍스트 바이트 동일, **부분 인덱스·빈 인덱스** 경계. term 집합 8종(무매치·빈 목록·중복·비ASCII·alias 포함) ✅ 2026-09-10 — 골든·패리티는 실행 경로 하나만 보므로 두 경로 대조는 별도 테스트가 필요하다
- [x] P4-16+ 정본과의 구조 분기 기록 — Python `scope-expand.py` 는 `lexical_seeds`·`expand` 가 각자 `lex_score` 를 돌리고(2패스), TS 는 1패스다. 정본은 **수정하지 않는다**(P1 리뷰 판정 유지). 분기를 `src/expand.ts` 주석과 `CLAUDE.md` 변경 이력에 남기고, 보증은 패리티 3종이 진다 ✅ 2026-09-10
- [x] P4-13+ (P4-01 측정 결과 반영) **캐시 범위 재정의** — 현행 P4-02~P4-04 는 `buildGraph` 만 캐시하지만, 1,000 페이지 실측 분해에서 buildGraph 는 호출 비용의 **29%**(52ms/183ms)뿐이다(lex 34% + bm25 37%). 노드별 파생 산출물 중 **term 과 무관한 것**(lex haystack `pyLower(text+"\n"+aliases)`, bm25 `scoreText`, `dl`)을 캐시 엔트리에 함께 실어야 ROI 가 난다. 착수 시 P4-02·P4-03 을 이 범위로 고쳐 쓴다 — 단, 파생값은 **원본 파일 변경 시 함께 무효화**되어야 하므로 무효화 단위를 파일→(노드+파생)으로 정의할 것 ✅ 2026-09-10 — `cache.ts derived(node, kind, compute)` 로 구현: 파생값을 **노드 객체에 WeakMap 으로** 매다는 방식이라 그래프가 교체되면 파생도 함께 사라진다(무효화 단위가 자동으로 노드). 적용 지점은 `expand.lexHay`·`bm25.scoreText`·`bm25 dl` 3곳. 누적 128MiB 상한. 효과: warm 호출이 lex·bm25 재계산을 통째로 건너뛴다(1,000p 190→24ms — 그래프만 캐시했다면 ~130ms 에 그쳤을 몫)
- [x] P4-18+ 착수 트리거 감시 — 위키 lint·주간리뷰 때 `node tools/llmwiki-mcp/dist/cli.js --selftest --root <VAULT>` 의 `pages`·`buildGraph_ms` 를 확인해 ①② 근접 여부만 본다(현재 309p·28ms). 근접하면 P4-01 을 갱신하고 캐시를 연다 ✅ 2026-09-10 — **캐시를 열었으므로 원래 목적(착수 시점 판단)은 소멸**. 감시 대상을 바꿔 남긴다: warm 호출은 walk+stat 스캔이 지배하므로(1,000p 17.4ms = warm 의 73%), 다음 병목은 **스캔 비용**이다. 페이지 수가 3,000 을 넘거나 warm 호출이 100ms 를 넘으면 스캔 자체를 줄이는 방법(디렉터리 mtime 프루닝·watch API)을 새 항목으로 연다

### D. 배포
- [x] P4-19+ (외부리뷰 1차 반영) 캐시 키 강화 — `stat`→`lstat`, `(dev, ino, mode, size, mtimeNs, ctimeNs)` + 볼트 realpath, `isFile()` 아니면 저장 금지 ✅ 2026-09-10 — codex B1·B2 / agy M2 를 문서화가 아니라 **설계 변경**으로 막았다. `cp -p` 재현 테스트 통과
- [x] P4-20+ (외부리뷰 1차 반영) 예산·수명 수정 — 파생 예산을 그래프 조립 시 리셋, 저장 전 예산 확인, `has()` 로 undefined 인정, 텍스트 캐시 256MiB 상한, root 캐시 `Map`(최대 4) ✅ 2026-09-10 — agy B2·MINOR / codex M2·m1
- [x] P4-21+ (외부리뷰 1차 반영) CI 에 캐시 off 패리티 + 퍼징 단계 추가 ✅ 2026-09-10 — `.github/workflows/ci.yml`: `LLMWIKI_CACHE=0 python tests/parity.py`·`python tests/parity_fuzz.py`. DoD 를 CI 가 지키게 됐다(agy M1·codex M3·M6)
- [x] P4-22+ (외부리뷰 1차 반영) 측정 하네스 정정 — `stage-bench` 는 캐시 off 강제, `cache-bench` 는 **정확히 2회차** 측정·표준 median ✅ 2026-09-10 — agy M3·codex M5. 재측정: 309p 48.4→9.2ms · 1,000p 195.4→26.4ms · 2,000p 379.5→48.9ms
- [x] P4-23+ (외부리뷰 2차 반영) 불안정 스냅샷의 적중·재사용 금지, 텍스트 예산 초과 시 그래프 미저장, 파생 예산을 전 root 합으로, root LRU, Windows ctime 서술 정정 ✅ 2026-09-10 — codex r2 B1·B3·M1·M3·m1·m2. 회귀 5건 추가(p4-cache 21건). 재검증: 41파일 572건 · 픽스처 0/56(on·off) · 퍼징 200/200 · 실볼트 0/20(on·off) digest `9bcb72a0a91edc08` 불변 · 1,000p 정확히 2회차 24.5ms
- [x] P4-24+ (외부리뷰 3차 반영) 누적 상한 즉시 판정, 전 root 텍스트 합 상한(LRU 축출), 스냅샷 lstat 동시성 풀, 축출 시 참조 해제 ✅ 2026-09-10 — codex r3 M1·M2·m3·m4 / agy r3 m1·m2. 회귀 4건 추가(p4-cache 25건). 재검증: 41파일 576건 · 픽스처 0/56(on·off) · 퍼징 200/200 · 실볼트 0/20(on·off) digest `9bcb72a0a91edc08` 불변 · 1,000p 정확히 2회차 26.6ms · pack 20파일(dist/cache.js 추가분)
- [x] P4-25+ (배선 점검 — 사용자 요청 "배선도 누락 재검토") 캐시·P4 변경이 코드·CLI·서버·CI·문서·릴리즈 계획에 빠짐없이 연결됐는지 소스로 전수 확인하고 누락을 고쳤다 ✅ 2026-09-10
      ↳ **① CI 읽기 전용 가드 실패(실제 결함)** — `src/cache.ts` 가 `import fs from "node:fs/promises"`(default import, 가드가 금지)였다. P4 브랜치를 한 번도 푸시하지 않아 CI 가 돌지 않았고 가드는 `ci.yml` heredoc 에만 있어 로컬 `npm run check` 로는 잡히지 않았다 → `import { promises as fs } from "node:fs"`(vault.ts 와 동일)로 수정. **재발 방지**: 가드 본문을 `tools/llmwiki-mcp/scripts/readonly-guard.py` 로 옮기고 CI 는 그 파일을 호출(규칙 무변경) — 로컬에서 `python3 scripts/readonly-guard.py` 로 같은 판정. P0~P3 교훈 1("문자열 리뷰는 실행을 대신 못 한다")의 CI 판: **CI 전용 검사는 로컬에서 돌릴 수 있어야 한다**
      ↳ **② 1회성 모드에 캐시가 순수 비용으로 배선됨** — `--once`·`--selftest` 는 프로세스당 1회 호출이라 적중 기회가 없는데 stat 스캔만 더해져 1,000p cold 가 off 대비 +7.7%(164.3→176.9ms)였고, `--selftest` 의 `buildGraph_ms`(P4-18+ 감시 지표·Codex 타임아웃 근거) 의미가 조용히 바뀌었다 → `setCacheDefault(false)` 를 cli 의 두 분기에 배선, `LLMWIKI_CACHE=1` 로 강제 on 가능. 서버 기본값은 on 그대로. CI 패리티 ON 단계는 `LLMWIKI_CACHE=1` 을 명시해 캐시 경로 커버리지를 유지. 실측: `--selftest` buildGraph_ms 25ms(v1 의미 복원)
      ↳ **③ `--help` 와 README 불일치** — README 의 help 블록에만 `LLMWIKI_CACHE` 가 있고 실제 `cli.ts` HELP 에는 없었다 → HELP 에 추가, `--help` 출력을 검사하는 테스트 추가
      ↳ **④ 문서 배선** — PRD §4("캐시는 v1 에서 안 함")·위험 표에 P4 구현 사실과 버전 경계 주석, 릴리즈 노트(v0.11.0)에 "P4 캐시는 이 태그에 포함되지 않음·publish 시점 커밋 확인" 명시, 릴리즈 노트 단위 테스트 수를 P3 끝 실측값(39파일 545건)으로 정정
      ↳ **⑤ P3 체크리스트 배선(첫 리뷰에서 지적했던 누락)** — 본문·헤더가 참조만 하던 P3-31+·P3-32+·P3-34+ 를 실체화(31+·34+ 는 반영 근거 확인 후 `[x]`, 32+ 는 환경 제약 `[ ] ⏸`), 헤더의 P3-33+ 를 본문과 같은 P3-32+ 로 통일, DoD pack 수(18→19)·P3-02 줄 수(15→17) 오기 정정
      ↳ 확인했으나 문제없음: 호출부 5곳(`once.ts` expand·`read.ts` read_page·`cli.ts` selftest·`search.ts`·`server.ts` 경유) 모두 `buildGraph`/`readTexts` 를 거침, `pack.ts` 는 선택 페이지만 `read()`(캐시 불필요), pack 가드 20파일·금지 경로 0, `dump-tools-list --check`·`templates/clients/build.py --check` 드리프트 0, eslint `test/perf/*.mjs` 블록 존재
      ↳ 재검증: 42파일 580건 · 가드 OK · 패리티 기본/`=1`/`=0` 전부 0/56 · 퍼징 200/200 · 실볼트 기본·`=1` 0/20 digest `9bcb72a0a91edc08` · `bench.py` selftest 파싱 정상
- [x] P4-26+ **Claude Code 실클라이언트 E2E** — tarball 설치본을 `claude -p --mcp-config --strict-mcp-config` 로 주입(사용자 설정 무변경), 실볼트 사본에서 수행 ✅ 2026-09-10 — A 사실브리핑(on): expand(rerank=11)→pack·read_page 0·신뢰도 병기 PASS · B 세션 도중 변조(같은 크기·mtime 복원, ctime 만 변화)(on): search·expand 모두 새 내용 반영 PASS, 2회차 expand 39→13ms · C 동일 절차(off): PASS, **도구 결과 5건 B 와 문자열 동일** · 프로토콜 직접 구동 on/off: stdout 비JSON 0줄·출력 동일 · 볼트 하네스 Python 경로 정상 · 실볼트 무변경(diff 0). 근거 `todo/evidence/P4-e2e-claude-code.md`
- [x] P4-27+ (E2E 에서 발견) **Claude Code 가 structuredContent 를 모델에 넘기고, 그 안에 `text` 와 `rows`/`pages` 가 같은 정보를 이중으로 담아 모델 입력이 텍스트 대비 2.06~4.24배**(pack 9,715B → 20,015B) — 팩의 토큰 절감 설계를 상쇄한다. **2026-09-10 사용자 결정: 2안(기본 텍스트만, `LLMWIKI_STRUCTURED=1` opt-in)** ✅ 2026-09-10 — 구현·측정·외부리뷰(codex·agy, 둘 다 BLOCKER 0) 반영 완료
      ↳ 구현: `server.ts` 가 `ServerOptions.structured`(기본 false)일 때 tools/list 에서 outputSchema 를 빼고 응답에서 structuredContent 를 뺀다(스펙상 둘은 함께). `callTool(…, structured=true)` 는 전체 계약 경로 그대로(outputSchema fail-closed 검증·envelope 예산) — 기존 P2/P3 테스트는 `p2-helpers.connect()` 기본 `structured: true` 로 opt-in 경로를 계속 검사. `cli.ts` 는 `LLMWIKI_STRUCTURED=1` 만 켠다('true' 등 다른 값은 off). 텍스트 전용 경로의 상한은 `capText`(read_page 는 `read.ts` 에서 이미 capText)로 유지
      ↳ 테스트 `p4-27-text-only-default.test.ts` 4건: 기본 서버 outputSchema·structuredContent 없음·오류 없음 / 두 모드 텍스트 **바이트 동일**(suggested_next 줄 포함) / 기본 모드 응답이 더 작음 / 실제 CLI stdio 서버의 env 배선(미지정·'1'·'true'). 전체 43파일 584건 통과
      ↳ 재측정(Claude Code, 실볼트 읽기 전용, 스니펫 없음): **사실 3/3·절차 2/2 준수**, JSON 으로 감싼 payload 0건, F1 모델 입력 expand 1,470→411B·pack 20,015→9,715B(텍스트와 동일). 근거 `todo/evidence/P4-e2e-claude-code.md`
      ↳ 외부리뷰 반영(codex: BLOCKER 0·MAJOR 4·MINOR 3 / agy: BLOCKER 0·MAJOR 3·MINOR 4 — 지적이 거의 겹침): ① 텍스트 전용 경로도 **응답 JSON 전체** 200KB 예산(JSON 이스케이프로 부푼 envelope 재측정·축소) ② `p2-helpers.connect()` 기본을 실제 서버와 같은 텍스트 전용으로 뒤집고, structuredContent 계약 테스트 12파일·직접 `callTool` 호출 21곳은 opt-in 을 **명시** ③ `callTool` 의 `structured` 인자를 필수로(서버 기본과 반대인 암묵값 제거) ④ 기본 모드 보안·상한 테스트 신설 `p4-27-default-mode-guards.test.ts` 17건(경로 탈출·입력 상한·오류 문구 두 모드 동일 12종, 심볼릭 링크 카나리, 이스케이프 대형 페이지 envelope, 큰 응답의 의도된 텍스트 차이) ⑤ README 도구 표·DESIGN §3·릴리즈 노트(0.2.0 호환성 변경 예고)·스펙 SHOULD(TextContent=JSON 직렬화) 의도적 예외 명시. `print-config --structured` 는 기각 — JSON 설정 env 블록·CLI `--env` 로 이미 켤 수 있어 README 예시로 대체
      ↳ **반영 중 드러난 P2 결함**: opt-in 경로의 envelope 예산이 `structuredContent` 만 재고 `content[0].text` 에 같은 텍스트가 한 번 더 실리는 몫을 세지 않았다 — 이스케이프 많은 대형 `read_page` 가 **341,496B**(상한 204,800B)로 나갔다. P2-23 테스트는 이 잘못된 측정을 '정확히 절반'으로 고정하고 있었다 → 전송 응답 전체(content+structuredContent)를 재도록 고치고, 축소를 '남은 예산의 절반에서 시작 + 실측 비율로 한 번에 보정'으로 바꿔 과절단 제거(고정 비율로는 25.6KB 까지 버렸다 → ASCII 본문 기준 절반 예산을 거의 다 씀). P2-23 단언을 올바른 불변식(전송 전체 ≤ 상한, 텍스트 ≤ 절반, 과절단 금지)으로 정정
      ↳ 재검증: 44파일 600건 · 가드 OK · tools-list 덤프 무드리프트 · 패리티 기본/`LLMWIKI_CACHE=1` 0/56 · 퍼징 200/200 · 실볼트 0/20 digest `9bcb72a0a91edc08`. 리뷰 원문 `review/P4-27-{codex,agy}-2026-09-10.md`
- [ ] P4-11 npm `0.2.0` publish, README 성능 절 갱신, `CLAUDE.md` 변경 이력 행 — **선행: P3-08 의 `0.1.0` publish**(승인 대기). 0.1.0 이 나가기 전에는 0.2.0 을 논하지 않는다 ⏸ 2026-09-10 — **문서 몫은 선반영**: README(Env 줄·`LLMWIKI_CACHE` 설명·한계 2줄 교체)·DESIGN §6·`CLAUDE.md` 이력 행 완료. 남은 것은 publish 뿐이며 P3-08 승인에 막혀 있다
- [x] P4-17+ (P4-12+ 몫) `CLAUDE.md` 변경 이력 행 추가 — 패키지 배포 없이 저장소에만 반영되는 변경이므로 P4-11 과 분리해 지금 기록 ✅ 2026-09-10

## 산출물
- `src/cache.ts`, 테스트, `P4-trigger.txt`, `P4-perf.txt`, npm 0.2.0
- (2026-09-10 실제 산출) **캐시**: `src/cache.ts`(신설)·`src/graph.ts`(`assemble` 분리·캐시 삽입)·`src/search.ts`·`src/expand.ts`(`lexHay`)·`src/bm25.ts`(파생 메모), `test/unit/p4-cache.test.ts`(10건), `test/perf/cache-bench.mjs`, README·DESIGN §6 갱신
- (2026-09-10 실제 산출) **이월분**: `src/expand.ts`(`lexIndex`)·`src/once.ts`, `test/unit/p4-12-lex-index.test.ts`, `test/perf/stage-bench.mjs`, `todo/baseline/P4-trigger.txt`·`P4-perf.txt`

## 완료 기준 (DoD)
- [x] 캐시 on/off 패리티 전건 동일 ✅ 2026-09-10 — 픽스처 56 on/off · 퍼징 200 on/off · 실볼트 20 on/off, digest 전부 `9bcb72a0a91edc08`. 단위 42파일 580건 통과(배선 점검 후)
- [x] 성능 목표 달성 기록 ✅ 2026-09-10 — 1,000p 정확히 2회차 **26.6ms**(목표 <100ms, 3차 반영 후 재측정), stat 스캔 비용까지 `todo/baseline/P4-perf.txt` 에 기록
- [x] 외부리뷰 완료 ✅ 2026-09-10 — 3라운드: 1차 codex·agy(BLOCKER 4) → 2차 codex(BLOCKER 3, agy 는 CLI 인증 오류로 미수행) → **3차 codex·agy 모두 잔여 BLOCKER 0**(agy '병합 가능'). 3차 MAJOR 2·MINOR 4 는 00-README 5항대로 같은 단계 안에서 반영·재검증
- [x] (이월분) P4-12+ 출력 무변경 완료 ✅ 2026-09-10 — 픽스처 패리티·퍼징 2 seed·실볼트 digest 동일·단위 551건, 세 볼트에서 `identical_output=true`

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/cache.ts`, 관련 테스트, 성능 기록
- 관점: ① 무효화 누락(stale 결과 반환) 경로 ② OneDrive 온디맨드 파일·mtime 정밀도(FAT/exFAT 2s) 함정 ③ 메모리 상한 부재의 위험 ④ 캐시가 보안 규칙(심볼릭 링크·경로 제한)을 우회하는 경로
- 관점(추가, 2026-09-10) ⑤ **정본 구조 분기**(P4-12+)가 패리티만으로 충분히 지탱되는가 — 픽스처가 닿지 않는 입력(부분 인덱스·빈 terms·중복 slug 볼트)에서 두 경로가 갈릴 여지 ⑥ 파생값 캐시(P4-13+)가 원본 무효화와 어긋나 **term 무관 파생만 낡는** 경로
- 절차: `00-README.md` 규칙. 프롬프트 `review/P4-prompt.txt`, 결과 `review/P4-agy-YYYY-MM-DD.md`

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| 1차 agy 2026-09-10 (`review/P4-agy-2026-09-10.md`, BLOCKER 2·MAJOR 3·MINOR 2) — **병합 불가** | | | | |
| p4-aB1 | BLOCKER | 미래 mtime 파일이 있으면 `now - mtimeMs` 가 음수 → 항상 "방금 수정" 판정 → 그 볼트 캐시가 영구 무력화되고 매 호출 캐시를 비움 | **수용**(실증) — `FUTURE_SKEW_MS`(5s) 도입: 창은 `[-5s, 2s)`. 그보다 더 미래인 mtime 은 시계 차이로 본다. 단순히 `ageMs >= 0` 로 막으면 `Date.now()` 의 ms 절삭 때문에 **갓 쓴 파일**을 놓치는 것을 자체 테스트가 검출 | `src/cache.ts` FUTURE_SKEW_MS, `p4-cache.test.ts` "[agy B1]" |
| p4-aB2 | BLOCKER | `derivedBytes` 가 전역이라 같은 볼트에서 수정이 누적되면 128MiB 를 넘어 파생 캐시가 영구 정지 | **수용** — `resetDerivedBudget()` 를 그래프 조립 시점(`buildGraph`)에 호출. 12회 반복 수정 테스트로 고정 | `src/cache.ts`·`src/graph.ts`, `p4-cache.test.ts` "[agy B2]" |
| p4-aM1 | MAJOR | CI 에 캐시 off 패리티·퍼징 단계가 없어 DoD 를 CI 가 지키지 못함 | **수용** — `.github/workflows/ci.yml` 에 `LLMWIKI_CACHE=0` 패리티 + `parity_fuzz.py` 단계 추가 | ci.yml |
| p4-aM2 | MAJOR | 2s 창 밖에서 mtime·size 를 보존한 채 내용이 바뀌면 낡은 적중(메타데이터 캐시의 한계) | **수용(설계 변경)** — 문서화로 끝내지 않고 키에 `ctime`·`ino`·`dev`·`mode` 를 넣어 실제로 막았다. `cp -p` 시나리오를 테스트로 재현 | `src/cache.ts` snapshot, `p4-cache.test.ts` "[codex B1·agy M2]" |
| p4-aM3 | MAJOR | `stage-bench.mjs` 가 캐시·파생 메모를 타서 단계 비용을 왜곡 | **수용** — 벤치가 `LLMWIKI_CACHE=0` 을 강제하고 출력에 표기. 재측정치로 근거 파일 갱신 | `test/perf/stage-bench.mjs`, `baseline/P4-perf.txt` |
| p4-am1 | MINOR | 단일 슬롯 root 캐시 — 두 볼트 교차 조회 시 매번 폐기 | **수용** — `Map<string, RootCache>`(`MAX_ROOTS` 4)로 전환, 교차 조회 적중 테스트 추가 | `src/cache.ts`, `p4-cache.test.ts` "[리뷰 MINOR]" |
| p4-am2 | MINOR | 누락 테스트(미래 mtime·장기 수정·search↔graph 상호작용·상한 혼합) | **수용** — 6건 추가(위 항목들 + search→graph 일관성) | `p4-cache.test.ts` "외부리뷰 반영 회귀" |
| 1차 codex 2026-09-10 (`review/P4-codex-2026-09-10.md`, BLOCKER 2·MAJOR 6·MINOR 2) — **병합 불가** | | | | |
| p4-cB1 | BLOCKER | `(path, mtime, size)` 만으로는 낡은 본문을 판별할 수 없음(mtime 복원·시계 보정·볼트 realpath 변경) | **수용** — 키를 `realpath(vault)` + `(경로, dev, ino, mode, size, mtimeNs, ctimeNs)` 로 확장. `ctime` 은 userland 가 되돌릴 수 없어 복원 시나리오를 잡는다 | `src/cache.ts` snapshot |
| p4-cB2 | BLOCKER | 캐시 적중 시 `read()` 를 건너뛰어 `O_NOFOLLOW`·realpath 검증이 빠짐. `stat` 은 링크를 따라감 | **수용** — `lstat` 으로 교체(링크 미추적) + `isFile()` 아니면 저장 금지 + `ino/mode` 키 포함 → 파일이 링크·다른 파일로 바뀌면 반드시 미스가 되어 `read()`(O_NOFOLLOW) 로 돌아간다. 순회·경계 검사는 애초에 호출마다 수행 | `src/cache.ts` snapshot, `p4-cache.test.ts` P4-10 |
| p4-cM1 | MAJOR | 권한 변경(chmod)이 키에 없어 접근성과 결과가 어긋남 | **수용** — `mode`·`ctimeNs` 가 키에 포함되므로 chmod 는 미스. 테스트 추가 | `p4-cache.test.ts` "[codex M3]" |
| p4-cM2 | MAJOR | 파생 예산이 실제 메모리 상한이 아님(문자열만 계수·마지막 하나가 초과·`undefined` 재계산) | **수용** — 값 저장 **전** 예산 확인, 숫자도 8B 로 계수, `has()` 로 `undefined` 캐시 인정, 텍스트 캐시에 `TEXT_BUDGET_BYTES` 256MiB 추가 | `src/cache.ts` derived·readTexts |
| p4-cM3 | MAJOR | 정본 구조 분기의 CI 증명 부족(캐시 on/off·퍼징 미실행) | **수용** — CI 에 두 단계 추가(p4-aM1 과 같은 조치) | ci.yml |
| p4-cM4 | MAJOR | 필수 무효화 케이스 누락(mtime 복원·미래 mtime·chmod·교차 root·stat 실패 복귀 등) | **수용(부분)** — mtime 복원·미래 mtime·chmod·교차 root·search↔graph 6건 추가. **walk 와 snapshot 사이의 링크 교체(TOCTOU)는 결정론적 재현이 어려워 미추가** — 대신 `lstat`+`ino/mode` 키로 그 창에서도 미스가 되게 만들었고, 상위 디렉터리 교체 경쟁은 P2-42+ 가 이미 "로컬 단일 사용자 범위에서 수용" 으로 판정한 잔여 위험이다(DESIGN §5) | `p4-cache.test.ts`, DESIGN §5·§6 |
| p4-cM5 | MAJOR | 성능 주장이 측정 범위보다 넓음(rerank 경로만·warm 정의·median 계산) | **수용** — `cache-bench.mjs` 에 **정확히 2회차** 측정 추가, 표준 median(짝수 평균)으로 수정, 라벨을 "warm(반복 median)" 으로 정정 | `test/perf/cache-bench.mjs`, `baseline/P4-perf.txt` |
| p4-cM6 | MAJOR | 리뷰 환경에서 `npm test`·parity 를 재현하지 못해 체크리스트 수치를 독립 검증할 수 없었음(EPERM·dist 없음) | **수용(절차)** — 캐시 on/off 패리티·퍼징을 CI 필수 단계로 승격해 3-OS 로그가 근거가 되게 했다. 로컬 재현 절차(`npm ci && npm run check` 후 `python3 tests/parity.py`)를 근거 파일에 명시 | ci.yml, `baseline/P4-perf.txt` |
| p4-cm1 | MINOR | root 캐시 1개만 유지 | 수용 — p4-am1 과 동일 조치 | `src/cache.ts` |
| p4-cm2 | MINOR | 외부리뷰 미완료 상태에서 `status: done` 으로 바꾸지 말 것 | **수용** — `status: review` 유지, DoD 외부리뷰 항목도 `[ ]` 로 남긴다 | 이 문서 상단 |
| 2차 codex 2026-09-10 (`review/P4-codex-r2-2026-09-10.md`, BLOCKER 3·MAJOR 3·MINOR 2) — **병합 불가**. agy 2차는 CLI 인증 오류로 미수행 | | | | |
| p4-r2B1 | BLOCKER | '방금 수정' 창이 저장만 막고 **기존 캐시 적중·텍스트 재사용은 허용** | **수용**(실증) — 불안정 스냅샷이면 `getGraph` 가 null, `readTexts` 는 전량 재독. 옛 신원을 든 스냅샷으로 재사용 경로를 직접 두드리는 회귀 테스트 | `src/cache.ts` getGraph·readTexts, `p4-cache.test.ts` "[codex r2 B1]" |
| p4-r2B2 | BLOCKER | 상위 디렉터리 교체 경쟁으로 realpath 경계 우회 → 외부 본문이 캐시될 수 있음 | **기각(근거)** — 캐시가 노출을 늘리지 않는다: 외부 본문은 외부 파일의 `dev/ino` 로 키가 잡혀, 다음 호출에서 교체가 유지되면 walkMd 가 그 파일을 빼고 원복되면 신원 불일치로 미스 → 캐시된 외부 본문은 **재제공되지 않는다**. 노출은 캐시 없는 한 호출과 동일하고, 그 잔여 위험은 P2-42+ 에서 수용됨. Node 에 `openat` 계열이 없어 구성요소 고정 순회는 불가 | DESIGN §6 |
| p4-r2B3 | BLOCKER | Windows `ctimeNs` 가 생성 시각이라 방어 불성립 | **부분 기각 + 정정** — 전제가 틀렸다: Node `ctime` 은 POSIX·NTFS 모두 **상태 변경 시각**(생성 시각은 `birthtime`, Node v24 공식 문서 "Stat time values"). 이 전제는 **내 1차 반영 주석의 오류**였고 리뷰어가 그대로 인용했다 → 주석·README·DESIGN 정정. 실제로 방어가 약한 FAT/exFAT·일부 네트워크 FS 는 README 한계 + `LLMWIKI_CACHE=0` 권고 | `src/cache.ts` 헤더, README, DESIGN §6 |
| p4-r2M1 | MAJOR | 텍스트 예산 초과 시에도 그래프가 저장돼 상한 우회 / 파생 카운터가 root 여러 개의 합을 못 셈 | **수용** — 예산 초과면 `snap.storable=false` 로 그래프도 미저장. 파생은 root 별 계수 + 전 root 합으로 예산 판정, 저장된 그래프 노드에만 세대 번호로 매단다 | `src/cache.ts`, `p4-cache.test.ts` "[codex r2 M1]" ×2 |
| p4-r2M2 | MAJOR | CI 가 캐시 적중·무효화 패리티(같은 프로세스 연속 호출)를 검증하지 않음 | **기각(사실 오류)** — CI 의 `npm run check` 가 vitest 전체를 3-OS 에서 돌리고, 여기에 `p4-cache.test.ts` 의 build→hit→mutate→rebuild·on/off 비교(21건)가 포함된다. `parity.py`·퍼징이 매 호출 새 프로세스라는 지적 자체는 맞으나 연속 호출 검증은 vitest 가 맡는다. 단 Windows 에서 의미가 다른 chmod 케이스는 `skipIf(win32)` 로 명시 | ci.yml(`npm run check`), `p4-cache.test.ts` |
| p4-r2M3 | MAJOR | 체크리스트 서술이 현재 구현·측정과 불일치(P4-02/03/04/07/09) | **수용** — 5개 항목 서술을 최신 구현(lstat·FileId·불안정 스냅샷·LRU)과 최신 측정(정확히 2회차 24.5ms)으로 교체, 옛 값은 '이력'으로 남김 | 이 문서 P4-02~P4-09·DoD |
| p4-r2m1 | MINOR | root 축출이 LRU 가 아니라 FIFO | **수용** — 접근 시 Map 순서 갱신. LRU 테스트 추가 | `src/cache.ts` rootCache, `p4-cache.test.ts` "[codex r2 m1]" |
| p4-r2m2 | MINOR | 필수 회귀 누락(기존 캐시+창 진입·FUTURE_SKEW 경계·stat 실패 복구·상한 혼합·Windows ctime·상위 디렉터리 경쟁) | **수용(부분)** — 창 진입(B1)·FUTURE_SKEW 경계·텍스트/파생 상한 3건 추가. stat 실패 복구는 추가·삭제 테스트가 같은 경로를 탄다. Windows ctime·상위 디렉터리 경쟁은 이 환경(darwin)에서 결정론적 재현이 불가 — 전자는 B3 정정으로 전제가 사라졌고 후자는 B2 근거로 기각 | `p4-cache.test.ts` "외부리뷰 2차 반영 회귀" |
| 3차 codex 2026-09-10 (`review/P4-codex-r3-2026-09-10.md`) — **BLOCKER 0**, r2B2·r2B3 기각을 "타당" 으로 확인 | | | | |
| p4-r3M1 | MAJOR | `readTexts` 가 전부 읽은 뒤 누적 상한을 검사 — 상한을 크게 넘는 볼트도 한때 전량 메모리 적재 | **수용**(소스 확인: `readAll` 은 읽을 때마다, `readTexts` 는 사후 검사였다 — agy 3차가 "완전히 동일" 이라 본 것은 틀림) — 적중분 포함 **읽는 즉시** 계수, 초과 시 다른 워커도 새 파일을 읽지 않음. 적중 텍스트도 `size ≤ MAX_FILE_BYTES` 재확인 | `src/cache.ts` readTexts, `p4-cache.test.ts` "[codex r3 M1]" |
| p4-r3M2 | MAJOR | 캐시 메모리 상한이 전역 하드캡이 아님(root 당 256MiB × 4) | **수용** — 전 root 텍스트 합 512MiB(`TOTAL_TEXT_BUDGET_BYTES`), 넘으면 LRU 로 다른 root 를 비우고 혼자 넘으면 미저장. README 에 "payload 기준 논리 상한, RSS 아님" 명시 | `src/cache.ts`, README, `p4-cache.test.ts` "[codex r3 M2]" |
| p4-r3m3 | MINOR | rename(slug 변경)·stat 실패 후 복구 회귀 누락 | **수용** — 2건 추가 | `p4-cache.test.ts` "[codex r3 m3]" ×2 |
| p4-r3m4 | MINOR | 리뷰 환경에서 vitest 가 임시 `ssr` 디렉터리 EPERM 으로 0건 실행 | **수용(절차)** — 재현 절차에 "쓰기 가능한 임시 디렉터리 필요(샌드박스 read-only 에서는 vitest 불가)" 명시. 코드 결함 아님(리뷰어 본인 판단과 동일) | `baseline/P4-perf.txt` |
| 3차 agy 2026-09-10 (`review/P4-agy-r3-2026-09-10.md`) — **병합 가능**, BLOCKER 0·MAJOR 0 | | | | |
| p4-r3am1 | MINOR | `snapshot()` 이 파일 수만큼 lstat 을 한꺼번에 던짐 | **수용** — 동시성 64 풀(`SNAPSHOT_CONCURRENCY`) | `src/cache.ts` snapshot |
| p4-r3am2 | MINOR | 축출된 root 의 그래프 참조가 GC 전까지 남음 | **수용** — `evict()` 가 graph·texts 참조를 명시적으로 끊는다 | `src/cache.ts` evict |
| P4-27+ codex 2026-09-10 (`review/P4-27-codex-2026-09-10.md`) — 병합 불가, BLOCKER 0 · agy (`review/P4-27-agy-2026-09-10.md`) — 조건부 보류, BLOCKER 0 | | | | |
| p427-M1 | MAJOR | 큰 응답에서 두 모드 텍스트가 달라 '바이트 동일' 주장이 거짓 | **수용** — 주장을 "작은 응답은 동일, envelope 초과 시 opt-in 이 더 짧음(의도)" 으로 정정하고 테스트로 고정 | server.ts 주석, README, DESIGN §3, `p4-27-default-mode-guards` |
| p427-M2 | MAJOR | 기본 경로가 envelope 예산을 건너뜀(JSON 이스케이프로 초과 가능) | **수용** — 텍스트 전용 envelope 재측정·축소 | server.ts, 테스트 |
| p427-M3 | MAJOR | 헬퍼 기본 opt-in 이라 실제 기본 경로의 보안·상한이 미검사 | **수용** — 헬퍼 기본 텍스트 전용, 계약 테스트는 opt-in 명시, 기본 모드 보안·상한 17건 신설 | p2-helpers.ts, 테스트 15파일 |
| p427-M4 | MAJOR(codex) / MINOR(agy) | structuredContent 의존 클라이언트 회귀, print-config 에 opt-in 없음 | **부분 수용** — README opt-in 예시·릴리즈 노트 0.2.0 호환성 변경 예고. `print-config --structured` 는 **기각**(env 블록·`--env` 로 이미 가능, CLI 표면 확대 회피). 0.1.0 은 미공개라 기존 사용자 없음 | README, RELEASE-NOTES |
| p427-m1 | MINOR | `callTool` 기본 true 가 서버 기본 false 와 반대 | **수용** — 인자 필수화 | server.ts |
| p427-m2 | MINOR | DESIGN·README 에 조건 없는 outputSchema/JSON 서술 잔존 | **수용** | DESIGN §3, README 표·suggested_next 문장 |
| p427-m3 | MINOR | opt-in TextContent 가 JSON 직렬화가 아님(스펙 SHOULD) | **수용(문서)** — 의도적 예외로 명시(텍스트 클라이언트·패리티 의존) | README, DESIGN §3 |
| p427-P2 | (반영 중 자체 검출) | opt-in envelope 이 structuredContent 만 재 전송량이 상한 초과(341,496B) | **수정** — 전송 전체 측정 + 비례 보정 축소, P2-23 단언 정정 | server.ts, p2-11-23 |

# P4 — (후속) 프로세스 내 mtime 캐시 v1.1

```
status: not-started        # not-started | in-progress | review | done
started:
completed:
external_review:           # pending | done → review/P4-agy-YYYY-MM-DD.md
```

- 근거: `../DESIGN.md §6`(성능), `../PRD.md §4 비목표`("캐시는 v1 에서 안 함 → v1.1")
- 선행 조건: **P3 done (v0.11.0 릴리즈)** 그리고 다음 중 하나가 관측될 때만 착수 — ① 실볼트 1,000 페이지 근접 ② 호출당 buildGraph 가 1s 초과 ③ 사용자가 지연을 체감. 관측 없으면 이 단계는 **열지 않는다(YAGNI)**.
- 완료 표시 방법: `00-README.md` 규칙

## 체크리스트

### A. 착수 판정
- [ ] P4-01 착수 사유 기록(위 ①②③ 중 무엇, 측정값) — `todo/baseline/P4-trigger.txt`

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

- [ ] P4-12+ (P1 코덱스 리뷰 #5 이월) lexScore 중복 계산 제거 — `lexicalSeeds` 가 distinct 캐시를 반환해 `expand` 가 재사용, BM25 `scoreText`·cpLen 도 그래프 빌드 시 1회 계산. **출력 무변경**(패리티 전건 유지가 조건). Python 정본은 그대로 둔다

### D. 배포
- [ ] P4-11 npm `0.2.0` publish, README 성능 절 갱신, `CLAUDE.md` 변경 이력 행

## 산출물
- `src/cache.ts`, 테스트, `P4-trigger.txt`, `P4-perf.txt`, npm 0.2.0

## 완료 기준 (DoD)
- [ ] 캐시 on/off 패리티 전건 동일
- [ ] 성능 목표 달성 기록
- [ ] 외부리뷰 완료

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/cache.ts`, 관련 테스트, 성능 기록
- 관점: ① 무효화 누락(stale 결과 반환) 경로 ② OneDrive 온디맨드 파일·mtime 정밀도(FAT/exFAT 2s) 함정 ③ 메모리 상한 부재의 위험 ④ 캐시가 보안 규칙(심볼릭 링크·경로 제한)을 우회하는 경로
- 절차: `00-README.md` 규칙. 프롬프트 `review/P4-prompt.txt`, 결과 `review/P4-agy-YYYY-MM-DD.md`

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| | | | | |

---
name: wiki-query
description: How to answer a question against the LLM wiki (v2) — locate pages via index.md + MoCs, read them, synthesize a cited answer that reports confidence and prefers active over stale info, and file good answers back as new pages. Use when querying/asking the wiki, comparisons/analysis, or "이거 위키에 저장/파일링".
---

# wiki-query (v2)

위키에 근거 있게 답하고 좋은 답을 환류한다. v2는 **신뢰도·최신성**을 답에 반영한다.

## 절차

1. **탐색.** `index.md` → 관련 `wiki/moc/{topic}-moc.md` → L3-semantic 페이지 순. 애매하면 `python3 .claude/skills/wiki-lint/scripts/search.py "<query>"`(L1–L4 전체 grep). 소스 원문 근거가 필요하면 L2-episodic도.

2. **정독.** 후보 페이지를 읽는다. frontmatter의 `confidence`·`status`·`last_confirmed` 확인.

3. **최신성·신뢰도 반영:**
   - `status: stale` 페이지는 답의 주근거로 쓰지 않는다 — `superseded_by`를 따라 현재 페이지로 간다(이력이 필요하면 "과거엔 X였으나 현재 Y" 식으로 병기).
   - 각 주장에 **신뢰도 병기**: 예 "PostgreSQL 사용 (confidence 0.85, 소스 2개 [[source-a]] [[source-b]])".
   - 저신뢰(<0.6) 주장은 그 사실을 밝힌다("단일 소스, 미확인").

4. **종합·인용.** 각 주장에 출처 페이지 `([[slug]])` 인용. 위키에 없으면 지어내지 말고 "위키에 없음" + 웹 검색/인제스트 제안.

5. **형식.** 기본 md, 비교면 표, (요청 시) Marp·차트.

6. **환류.** 재사용 가치 있는 답(비교·분석·발견한 연결, **브리핑·보고·종합**)은 파일링 제안 — 특히 여러 소스를 엮은 답은 채팅으로 흘리지 말고 남긴다. 승인 시:
   - **개념·사실**이면 `wiki/L3-semantic/`에 `type: concept`(또는 fact).
   - **브리핑·보고·상태 요약**처럼 시점 종속 답이면 `type: query`(예: `query-<주제>-YYYY-MM-DD.md`). **`type`은 query, 계층은 L2-episodic** — query는 "그 시점에 종합한 것"이라 본질이 일화(episodic)다(그래서 `decay_class: episodic`로 시간 지나면 바램). 계층=L2, 유형=query로 source/session과 구분한다.
   - 공통: sources·confidence·last_confirmed·decay_class 부여, 근거 페이지와 양방향 링크, 알맞은 MoC 편입, log append(`## [오늘] query | <요지>`).

## 왜 신뢰도를 보이나
v1은 모든 정보가 동등해 보였다 — 단일 트윗과 3소스 확인 사실이 같은 무게. 신뢰도를 답에 노출하면 사용자가 무엇을 믿을지 판단할 수 있고, 저신뢰 주장은 보강 대상으로 드러난다.

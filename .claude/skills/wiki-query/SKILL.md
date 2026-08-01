---
name: wiki-query
description: How to answer a question against the LLM wiki (v2) — locate pages via index.md + MoCs, read them, synthesize a cited answer that reports confidence and prefers active over stale info, and file good answers back as new pages. Use when querying/asking the wiki, comparisons/analysis, or "이거 위키에 저장/파일링".
---

# wiki-query (v2)

위키에 근거 있게 답하고 좋은 답을 환류한다. v2는 **신뢰도·최신성**을 답에 반영한다.

> **모델·속도(v0.8.1):** 질의는 추출·인용 위주라 `wiki-synthesizer` 기본 **sonnet**(빠름·저비용). 깊은 비교·다소스 종합·분석은 오케스트레이터가 spawn 시 **opus로 override**.

> **리트리벌(v0.8.5 — 질의유형 라우팅, A/B 5라운드 실측):** **index.md 통독 금지.** 오케스트레이터가 `scope-expand.py`로 사전스코프(0토큰)해 질의유형별로 넘긴다 — **사실브리핑=claims 팩**(rerank11로 조인 후보), **절차/how-to=후보 목록(full-read)**, **단일조회=seed만**. 순수 lexical은 관계연결 페이지에 못 닿아 recall이 깨진다 → 그래프 1홉 확장이 정본. 실측: 사실질의 광역탐색 대비 −55%(22.7k/1read).

## 절차 (질의유형별)

1. **사실브리핑·비교 — 팩 우선(index 통독 금지).**
   - 오케스트레이터가 `scope-expand.py expand … --rerank 11` → `pack`으로 만든 **컨텍스트 팩 1파일**을 먼저 읽는다. rerank로 조인 후보라 팩 1-read로 대개 충분.
   - claims로 **충분하면 개별 full-read 금지**. 특정 주장에 불충분할 때만 그 페이지 골라 full-read.
2. **절차·how-to — 후보 full-read.**
   - 팩이 아니라 **후보 목록**을 받는다(절차는 세부 넓이가 필요 → 팩 요약은 부족). 후보 페이지를 `wiki/`에서 정독하고, 링크추적으로 빠진 핵심 1~2개만 추가 read.
3. **단일조회 — seed만.** 스크립트/단일 페이지로 즉답.
- 공통: **index.md 전량 read·광역 MoC 스윕 금지.** 팩 없거나 후보 빈약하면 `search.py --files`로 직접 스코프(fallback MoC는 1개까지, `ls wiki/moc/` 파일명 매칭).

2. **정독.** 후보 페이지를 읽는다. frontmatter의 `confidence`·`status`·`last_confirmed` 확인.

3. **최신성·신뢰도 반영:**
   - `status: stale` 페이지는 답의 주근거로 쓰지 않는다 — `superseded_by`를 따라 현재 페이지로 간다(이력이 필요하면 "과거엔 X였으나 현재 Y" 식으로 병기).
   - 각 주장에 **신뢰도 병기**: 예 "PostgreSQL 사용 (confidence 0.85, 소스 2개 [[source-a]] [[source-b]])".
   - 저신뢰(<0.6) 주장은 그 사실을 밝힌다("단일 소스, 미확인").

4. **종합·인용.** 각 주장에 출처 페이지 `([[slug]])` 인용. 위키에 없으면 지어내지 말고 "위키에 없음" + 웹 검색/인제스트 제안.

5. **형식.** 기본 md, 비교면 표, (요청 시) Marp·차트.

6. **환류 (선택적 — 매번 하지 마라).** 파일링은 **재사용 가치가 확실할 때만** — 여러 소스를 엮은 종합·비교·분석·보고. 아래는 **환류하지 말고 참조/답변만**(spawn·파일쓰기 오버헤드 절약):
   - **이미 정본 페이지가 있는 질문** — 기존 `query-*`/`concept-*`가 답을 담고 있으면 재작성 말고 그것을 참조(신 정보 있을 때만 갱신).
   - **단순 조회·일회성** — 단일 사실 확인, "지금 상태 뭐야" 류.
   재사용 가치 있는 답(비교·분석·발견한 연결, **브리핑·보고·종합**)만 파일링 제안. 승인 시:
   - **개념·사실**이면 `wiki/L3-semantic/`에 `type: concept`(또는 fact).
   - **브리핑·보고·상태 요약**처럼 시점 종속 답이면 `type: query`(예: `query-<주제>-YYYY-MM-DD.md`). **`type`은 query, 계층은 L2-episodic** — query는 "그 시점에 종합한 것"이라 본질이 일화(episodic)다(그래서 `decay_class: episodic`로 시간 지나면 바램). 계층=L2, 유형=query로 source/session과 구분한다.
   - 공통: sources·confidence·last_confirmed·decay_class 부여, 근거 페이지와 양방향 링크, 알맞은 MoC 편입, log append(`## [오늘] query | <요지>`).

## 왜 신뢰도를 보이나
v1은 모든 정보가 동등해 보였다 — 단일 트윗과 3소스 확인 사실이 같은 무게. 신뢰도를 답에 노출하면 사용자가 무엇을 믿을지 판단할 수 있고, 저신뢰 주장은 보강 대상으로 드러난다.

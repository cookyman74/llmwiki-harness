---
name: wiki-ingest
description: How to ingest a raw source into the LLM wiki (v2.1 lazy) — write a L2-episodic evidence page and NEW L3 concept drafts only; defer merge, confidence recompute, relations, and L2→L3 promotion to the batch consolidation at lint. Cheap & fast. Use when ingesting/processing/파일링 a source dropped into raw/.
---

# wiki-ingest (v2.1 — lazy·경량)

한 소스를 위키에 넣는다. **핵심: 인제스트는 싸고 빠르게, 정제는 나중에 배치로.**
- 인제스트가 하는 것: **L2 증거 페이지 + 신규 개념 초안**만.
- 인제스트가 **안 하는 것**: 기존 페이지 병합·신뢰도 재계산·관계 구조화·L2→L3 승격 → 전부 **lint/`wiki-consolidate` 배치**로 지연(opus).

왜: v2에서 인제스트가 소스마다 기존 페이지를 전수 Read하고 병합·관계까지 하니 위키가 클수록 O(n)로 토큰이 폭증했다. 병합은 본질적으로 **누적 후 일괄**이 효율적이다(같은 주장 3회+ 승격도 원래 lint 시점). 인제스트는 증거만 남기고 빠진다.

규약 정본: `CLAUDE.md`.

> **주의:** 페이지 파일에 `</content>` 같은 **닫는 태그·래퍼를 절대 붙이지 마라.** 파일은 순수 마크다운(frontmatter + 본문)으로 끝난다. (과거 인제스트가 EOF에 stray `</content>`를 남겨 85개 파일을 sweep한 적 있음.)

## 절차

1. **소스 읽기 + 중복 체크.** `raw/` 대상. **본문 immutable.** frontmatter `ingest_status: done`이면 이미 인제스트 — 사용자에게 알리고 중단(재인제스트는 갱신 모드 별도). 소스 유형 판별(official/code/normal/verbal).

2. **기존 개념 파악 — 본문 Read 금지.** 다음 한 줄 실행으로 기존 L3/L4 카탈로그만 본다(45개 페이지 본문을 읽지 마라):
   ```bash
   bash .claude/skills/wiki-ingest/scripts/concept-index.sh .
   ```
   출력(slug|title|aliases|confidence)으로 소스의 개념이 **이미 있는지(기존)** vs **없는지(신규)** 판별한다.

3. **L2 증거 페이지** → `wiki/L2-episodic/source-<slug>.md`. **이것이 인제스트의 주 산물.**
   ```yaml
   ---
   type: source
   title: <한국어 제목>
   tags: []
   created: <오늘>
   updated: <오늘>
   last_confirmed: <오늘>
   decay_class: episodic
   source_url: <URL/raw 경로>
   source_kind: official | code | normal | verbal
   ---
   ```
   본문: 2–3문장 요약 + `## 주장 (claims)`에 핵심 사실을 `- claim:: <내용>`으로 8~12개. **기존/신규 개념 모두 claim::으로 기록** — 이 재등장 신호가 lint의 병합·신뢰도 상승·승격 입력이 된다(그래서 인제스트가 기존 페이지를 안 건드려도 된다).

4. **신규 개념만 L3 초안 생성.** 2단계에서 **없다고 판별된 개념만** `wiki/L3-semantic/concept-<slug>.md`(또는 entity-) 생성:
   ```yaml
   type: concept
   confidence: 0.6           # 신규 단일소스 고정 — 재계산은 lint
   sources: [<이 소스 슬러그>]
   last_confirmed: <오늘>
   decay_class: concept
   ```
   본문은 한국어 골격(요약 + 핵심 몇 줄) + 관련 `[[ ]]` 링크 몇 개. **관계 `## 관계` 구조화는 생략**(lint 배치). **기존 개념과 겹치면 새로 만들지도, 기존을 열지도 마라** — claim::만 남기면 lint가 병합한다.

5. **MoC 편입(가볍게).** 신규 L3만 알맞은 기존 MoC에 한 줄 추가. 새 주제 영역이면 MoC 1개 생성. 깊은 큐레이션은 `wiki-cartographer`/lint 몫.

6. **index.md + log.md + raw 스탬프.**
   - index: 신규 페이지만 추가.
   - log: `## [오늘] ingest | <제목>` + 신규 N개·claim M개.
   - raw 스탬프: 파일 맨 위 메타만(본문 무변경) — `ingested`·`wiki_source: [[source-<slug>]]`·`ingest_status: done`.

7. **보고 + 지연 안내.** 신규 페이지·claim 수 보고 + "병합·신뢰도·관계·승격은 다음 lint에서 배치 처리" 명시.

## 모델 라우팅 (비용)
이 경량 인제스트는 추출·파일쓰기 위주라 **sonnet**으로 충분하다(`wiki-ingestor` 기본 sonnet). 병합 판단·관계 추론 같은 고추론은 lint의 `wiki-consolidate`(opus)가 배치로 담당한다.

## 지연되는 일 (→ lint/consolidate)
- 기존 개념과의 **병합**(사실 통합·소스 추가)
- **신뢰도 재계산**(2소스 0.85·3+ 0.95) — L2 claim:: 재등장 카운트로 배치 산정
- **관계 `## 관계`** 구조화
- **L2→L3 승격**(같은 주장 3회+)·**L3→L4**
상세: `.claude/skills/wiki-consolidate/SKILL.md`.

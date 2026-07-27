---
name: wiki-consolidate
description: Runs the 4-tier memory consolidation pipeline of the LLM wiki — compress L1-working into L2-episodic at session end, promote recurring claims L2→L3-semantic, extract repeated procedures L3→L4-procedural, and recompute confidence. Use for "세션 종료/마무리", "L1 압축", "통합/consolidate", "승격", "기억 정리", and during lint passes.
---

# wiki-consolidate

인간 기억을 본뜬 **4계층 통합 파이프라인**. 정보는 아래층(휘발·구체)에서 위층(영속·추상)으로 **승격하며 정제**된다. 무엇이든 영원히 동등하지 않다 — 반복 확인된 것만 위로 올라간다.

```
L1-working  →  L2-episodic  →  L3-semantic  →  L4-procedural
(세션 스크래치)  (세션·소스 증거)   (사실·엔티티·개념)   (절차 steps)
```

## L1 → L2 (세션 종료 시)
목적: 작업기억을 비우되 잃지 않는다.
1. `wiki/L1-working/`의 모든 관찰을 읽는다.
2. **3–5줄로 압축** — 이번 세션에서 무엇을 관찰/결정했나.
3. `wiki/L2-episodic/session-YYYY-MM-DD.md`로 저장 (`type: session`). 압축 안에 핵심 주장은 `- claim:: <내용>` 인라인 필드로 표기(→ L2→L3 클러스터링 대상).
4. `wiki/L1-working/`를 비운다(.gitkeep만 남김).
5. log.md에 `## [오늘] consolidate | L1→L2 session` append.

## L2 → L3 (lint 시)
목적: 반복 관찰된 일화를 지속 지식으로 승격.
1. `python3 .claude/skills/wiki-consolidate/scripts/list-claims.py .` — L2 전체의 `claim::` 라인 수집.
2. **의미가 같은 주장을 클러스터링**(스크립트는 라인만 모음, 동치 판단은 LLM). 같은 주장이 **3회 이상** 서로 다른 세션/소스에서 등장하면 승격 후보.
3. **모순 증거가 있으면 승격 보류** — 대신 lint 리포트에 상충으로 보고.
4. 승격: `wiki/L3-semantic/fact-<주제>.md` 생성/갱신. frontmatter에 `sources: [...]`, `confidence:`(→ confidence.py 계산), `last_confirmed: 오늘`, `decay_class:`. 근거 세션/소스와 양방향 링크. 알맞은 MoC 편입.
5. log append.

## L3 → L4 (lint 시)
목적: 반복되는 방법을 절차로 추출.
1. L3에서 **같은 절차가 2회 이상** 관찰되면 후보.
2. `wiki/L4-procedural/procedure-<주제>.md`로 **steps 구조**화:
   ```markdown
   ## 단계
   1. <행동>
   2. <행동>
   ```
   `type: procedure`, `decay_class: procedure`(느린 망각), `last_confirmed: 오늘`.
3. 원천 L3 페이지와 링크. MoC 편입. log append.

## 배치 병합 (lazy 인제스트 후속 — v2.1)
경량 인제스트는 기존 개념을 안 건드리고 L2에 `claim::`만 남긴다. lint에서 그 지연분을 **일괄** 처리한다(고추론 = opus):
1. `python3 .claude/skills/wiki-consolidate/scripts/list-claims.py .`로 L2 전체 claim 수집 + `python3 .claude/skills/wiki-ingest/scripts/concept-index.py .`로 기존 L3 카탈로그.
2. **claim ↔ 기존 L3 매칭.** 같은 개념을 말하는 claim이 있으면 해당 L3 페이지에 사실 통합 + `sources:`에 그 소스 추가.
3. **신뢰도 재계산**(아래) + `last_confirmed` 갱신.
4. **관계 `## 관계` 구조화**(인제스트에서 지연된 것) — 개념 간 uses/depends_on/caused/fixed 등 추가.
5. **중복 초안 정리** — 같은 개념의 신규 초안이 둘 이상이면 병합(supersession 규칙).
- **왜 배치인가:** 병합은 여러 소스가 쌓인 뒤 한 번에 보는 게 효율적이다(소스마다 O(n) 전수 스캔 회피). 한 lint에서 이슈 다수를 묶어 처리해 오케스트레이터 왕복도 줄인다.

## 신뢰도 재계산
승격·재확인 시 `python3 .claude/skills/wiki-consolidate/scripts/confidence.py --kinds <official,normal,verbal,…>` (또는 `--count N --official/--verbal`)로 점수를 구해 frontmatter `confidence:`에 기록. 규칙: 1소스 0.6·2소스 0.85·3+ 0.95, 공식/코드 +0.1, 구두 −0.1.

## 왜 계층인가
v1은 모든 정보가 평평하고 동등했다 — 일시적 버그 메모와 핵심 아키텍처 결정이 같은 무게. 계층은 **반복·시간·신뢰도로 정보를 차등**한다. 자주 확인되는 것은 위로 올라가 오래 살고(L4 절차), 한 번 스친 것은 아래에서 망각된다(L1/transient). 사람 기억이 그렇게 작동한다.

## 자동 적용 금지
승격·stale 마킹·아카이브는 **제안 먼저**. L1→L2 압축은 세션 종료 루틴이라 사용자 확인 후 실행(자율 모드면 생략). 승격은 lint 리포트에 후보로 올리고 승인받아 반영.

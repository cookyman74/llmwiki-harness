# A/B 테스트 계획 — 질의 최적화 ①②③ (적용 전/후)

- **목적**: ①②③ 적용 **전(Arm A=baseline)** vs **후(Arm B=optimized)**를 동일 질의로 비교, 토큰·속도 절감과 품질 회귀 여부를 정량 측정. 스킬 정식 배선 전에 근거 확보.
- **원리**: 두 arm 모두 `wiki-synthesizer`(sonnet)로 spawn하되 **프롬프트 전략만 다르게** 준다. Arm A=현행 광역 탐색 지시, Arm B=사전스코프 후보만. search.py `--files`는 이미 추가됨(additive — 기존 동작 무변경)이라 스킬 미배선 상태로도 B 실행 가능.
- **공정성**: 같은 질의·같은 모델·같은 위키 스냅샷. 차이는 리트리벌 전략뿐. 각 spawn의 `<usage>` 블록으로 실측.

## 질의셋 (고정 2개 — baseline 실측 있음)

| ID | 질의 | baseline 실측(직전) |
|---|---|---|
| Q1 | "클로드코드와 관련하여 사내 교육을 어떻게 하면 좋을까?" | 61.8k tokens / 19 tool_uses |
| Q2 | "차주에 어떤 업무를 준비하면 좋을까?" | 52.4k tokens / 12 tool_uses |

## 골든셋 (recall 기준 — 직전 답변이 인용한 핵심 근거)

- **Q1**: concept-curriculum-flow, source-ax-rollout-reply, concept-ax-rollout-plan, concept-skill-two-types, concept-skill-automation, concept-engineering-ladder, concept-team-ai-adoption, concept-harness-design-spec, concept-subagent, concept-approval-gate, source-genai-lecture-1, source-lecture2-part1, concept-llm-wiki
- **Q2**: source-ax-rollout-reply, concept-ax-rollout-plan, source-monthly-report-automation, concept-monthly-report-automation, query-report-to-leejh-2026-07-30, session-2026-07-31, entity-recruitment-system, source-daily-2026-07-27, entity-vault-mcp, infra-auth-moc

recall = (arm이 읽거나 인용한 골든셋 페이지 수) / (골든셋 크기). Arm B의 후보가 골든셋을 얼마나 덮는지가 핵심.

## 사전스코프 후보 (Arm B 입력 — search.py --files 실행 결과, 2026-08-01)

- **Q1** `search.py --files 교육 강의 커리큘럼 스킬 클로드코드 --top 8`:
  `home-moc, concept-curriculum-flow, claude-code-moc, source-ax-rollout-reply, concept-ax-rollout-plan, concept-engineering-ladder, source-lecture3-part2, source-lecture3-part4`
- **Q2** `search.py --files 차주 교육 베타 보고서 자동화 이정호 PoC --top 8`:
  `source-ax-rollout-reply, concept-ax-rollout-plan, ax-rollout-moc, home-moc, query-report-to-leejh-2026-07-30, concept-monthly-report-automation, source-monthly-report-automation, concept-autonomy-ladder`

> 후보 커버리지(사전 확인): Q2 후보가 골든셋 10개 중 6개 직접 포함(ax-rollout-reply·plan, query-report, monthly-report ×2 + moc). 나머지(session·recruitment·daily·vault-mcp·infra-auth)는 후보 페이지의 `## 관계`·링크로 추적 가능 → synthesizer fallback search로 확보 예상. Q1 후보는 골든셋의 curriculum-flow·ax-rollout·engineering-ladder·lecture 직접 포함, skill-two-types·team-ai-adoption 등은 fallback 대상.

## Arm 프롬프트

### Arm A — baseline (현행 광역 탐색)
```
질의: "<질의>"
위키를 근거로 답하라. index.md에서 관련 페이지를 찾고, 관련 MoC를 열람한 뒤,
후보 L3 페이지들을 정독해 종합하라. 각 주장에 confidence·출처([[slug]]) 병기,
stale은 superseded_by 따라감. 재사용 가치 높으면 type:query 파일링 제안.
(※ 현행 wiki-query 절차 그대로 — index→MoC→다수 페이지)
```

### Arm B — optimized (사전스코프)
```
질의: "<질의>"
우선 read 후보(사전스코프 search.py --files): <위 후보 slug 목록>
- index.md를 통독하지 마라. 위 후보를 정독해 종합하라.
- 스코프 신뢰도가 낮거나 답이 불완전하면 키워드를 바꿔 search.py --files를 추가 호출해 확보하라(광역 index/MoC 스윕 금지).
- 각 주장에 confidence·출처([[slug]]) 병기, stale은 superseded_by 따라감.
- 답변 길이는 질문 범위에 맞춰라. 재사용 가치 높으면 type:query 파일링 제안.
```

## 측정 지표 (arm별·질의별 기록)

| 지표 | 출처 | 목표(B vs A) |
|---|---|---|
| subagent_tokens | spawn `<usage>` (end-to-end 누적) | ≥30% ↓ |
| tool_uses | spawn `<usage>` | ↓ (≤6 read 지향) |
| index.md read 여부 | arm 실행 로그 | A=Y, B=N |
| recall | 인용/read ∩ 골든셋 ÷ 골든셋 | B ≥ A − 5%p (회귀 없음) |
| 품질(신뢰도병기·인용·stale회피·환류) | 정성 + 골든셋 인용 누락율 | 유지 |

## 절차

1. **Arm A·B를 질의별로 각각 spawn**(총 4런: Q1-A, Q1-B, Q2-A, Q2-B). 각 arm은 **fresh wiki-synthesizer**(컨텍스트 격리, 공정 비교). Arm B는 위 사전스코프 후보를 프롬프트에 주입.
2. 각 런의 `<usage>`(subagent_tokens·tool_uses·duration) + 답변 텍스트 수집.
3. recall 채점: `ab-score.py`로 답변 텍스트 내 골든셋 slug 등장 수 집계(아래).
4. `metrics/ab-results.csv`에 1런당 1행 기록.
5. A vs B 표로 비교·감소율 산출. 품질 회귀(누락된 골든셋 근거) 정성 확인.

## 채점 도구

`develop_docs/v0.8.3/ab-score.py` — 답변 텍스트 파일 + 골든셋을 받아 recall 계산(0토큰):
```
python3 develop_docs/v0.8.3/ab-score.py <answer.txt> Q1|Q2
  → 출력: recall 0.62 (8/13) | 누락: skill-two-types, team-ai-adoption, ...
```

## 결과 기록 (실행 후 채움)

| 질의 | Arm | tokens | tool_uses | index_read | recall | 품질 |
|---|---|---|---|---|---|---|
| Q1 | A |  |  | Y |  |  |
| Q1 | B |  |  | N |  |  |
| Q2 | A |  |  | Y |  |  |
| Q2 | B |  |  | N |  |  |

## 판정 기준

- **채택(Go)**: B가 토큰 ≥30%↓ **그리고** recall 회귀 ≤5%p **그리고** 품질 정성 유지 → 설계 배선 진행(v0.8.4).
- **보류**: 토큰은 줄었으나 recall/품질 회귀 → 키워드 추출·--top·fallback 규칙 보정 후 재테스트.
- **기각**: 토큰 절감 미미(<15%) → 원인 재진단(사전스코프 외 드라이버).

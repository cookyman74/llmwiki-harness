# 설계서 — 질의 토큰·지연 최적화

- **대상 PRD**: `develop_docs/v0.8.3/PRD.md`
- **작성일**: 2026-08-01 (rev2 — A/B 실측 반영)
- **변경 파일**: `scope-expand.py`(신설) · `search.py`(--files) · `wiki-ops/SKILL.md` · `wiki-query/SKILL.md` · `wiki-synthesizer.md`

## ⚠️ 개정 이력 (A/B 실측 반영)
**rev1(순수 lexical 사전스코프)은 A/B 2·3차에서 recall 회귀 확인 → 폐기.**
- 실측: Arm B(순수 lexical top-8) 토큰 −19~34%였으나 recall Q1 0.54→0.38·0.46, **Q2 0.80→0.50**(재현). 목표 회귀 ≤5%p 실패.
- 원인: 누락 페이지(session·recruitment·vault)는 **키워드가 아니라 관계/내비게이션으로 도달** → 순수 lexical grep의 구조적 한계. fallback search도 관계 페이지엔 못 닿음.
- **rev2 처방(추천 조합)**: ①을 **그래프 확장 스코프**로 대체(관계 1홉 결정적 복원) + ② **claims 컨텍스트 팩**(토큰·왕복↓) + ④ **질의 유형 라우팅**(브리핑 recall 격리). 아래는 rev2.

## 개요 — rev2 질의 흐름 (그래프확장 + claims팩)

```
[현재]   질의 → synthesizer: index통독(218줄) → MoC 다수 → 다수 full-read(12~19) → 종합
[rev1✗]  질의 → search.py --files(top8) → synthesizer 표적read   ← recall 회귀(관계 못 닿음)
[rev2✓]  질의 → 오케스트레이터(0토큰):
             1) scope-expand.py expand  : lexical seed → 관계 1홉(아웃·인·MoC멤버) 확장
                                          → lexical 필터로 노이즈 억제 → 후보 slug
             2) scope-expand.py pack    : 후보들의 frontmatter+claims만 → 컨텍스트 팩 1파일
          → synthesizer: 팩 1개 read(15후보≈2~4k토큰) → 부족분만 개별 full-read → 종합
```

핵심 이동: **광역 탐색(비쌈)** → **결정적 그래프 스코프+팩(공짜 스크립트)**. recall은 관계확장으로 유지, 토큰은 팩(claims=증류사실)으로 절감, 왕복은 1 read로 축소.

---

## rev2-① 그래프 확장 스코프 (scope-expand.py — 신설)

순수 lexical(search.py --files)이 관계 페이지에 못 닿는 문제를 결정적 그래프 확장으로 해결.

### expand 모드
```
scope-expand.py expand "<kw>" [kw…] [--top-seed 6] [--max 15]
  1) lexical seed: 본문+aliases 매치 상위 N개(search.py --files 로직 재사용)
  2) 1홉 확장: 각 seed의 아웃링크 ∪ 인링크 ∪ (MoC면)멤버
  3) 노이즈 억제:
     - 루트 허브(outdegree>12, home-moc 등)는 멤버 팬아웃 금지
     - 확장 노드(tier≥1)는 lexical distinct>0 이거나 seed 2개+가 가리켜야 채택
  4) 랭크: tier(seed<1hop<moc멤버) → lexical → seed참조수
  출력: <tier>\t<refs>\t<slug>\t<type>
```
- 위키의 링크 그래프([[…]] 파싱, 별칭→slug 정규화, 인링크 역맵)를 매 호출 구성(0토큰, ~170페이지 즉시).
- **실측 효과(2026-08-01)**: rev1이 놓친 Q2의 session-2026-07-31·entity-vault-mcp·source-poc-sso-mcp·source-daily-27·infra-auth-moc가 확장 후보에 **도달**. Q1의 harness-design-spec·skill-two-types·skill-automation 도달.

## rev2-② claims 컨텍스트 팩 (scope-expand.py pack)

후보를 synthesizer가 N번 full-read하는 대신 오케스트레이터가 한 번에 압축 전달.
```
scope-expand.py pack <slug…>
  각 페이지: "## <slug> [type·conf·status]" + claim:: 줄 전량
  claims 없는 개념/엔티티는 첫 요약 문단 1줄
```
- claims:: = 이미 증류된 사실 → 산문 본문 생략해도 사실 손실 적음.
- **실측**: Q2 후보 16개 → 팩 8.5KB(~2.1k토큰). synthesizer가 팩 1 read로 15페이지 대체 → tool_uses·토큰 급감.
- 안전성: 결정적 조립이라 synthesizer가 스코프를 지어낼 여지 없음. 팩 불충분분만 개별 full-read.

## rev2-③ 프롬프트 슬림 (기존 유지)

후보 나열·요약 대신 **팩 파일 경로 + 후보 slug 목록**만 전달. 출력 길이는 질의에 맞춤. (rev1-③과 동일 취지)

## rev2-④ 질의 유형 라우팅 (recall 안전 격리)

- **단일사실·조회**("pending 몇 개", "X의 confidence") → lexical seed만(팩 소형), 저렴.
- **포괄 브리핑·비교·분석**("차주 업무 전부", "A vs B") → **그래프 확장 + 팩**. recall 격리.
- 오케스트레이터가 질의 성격으로 분기. 애매하면 브리핑이 기본(안전측).
- ⚠️ **브리핑이라고 `--max`를 키우지 마라**(아래 실험 결론) — 넓힘은 recall 안 올리고 팩만 비대. 브리핑엔 `--max` 대신 **키워드 풍부화**로 대응.

---

## 실험 결론 (A/B 4라운드, 2026-08-01 — `metrics/ab-results.csv`)

| Arm | 방식 | Q2 tokens/tools/recall | 판정 |
|---|---|---|---|
| A | baseline 광역(index+MoC) | 50.6k / 14 / 0.80 | 비쌈·느림 |
| B | 순수 lexical top8 | 33.6k / 10 / 0.50 | recall 회귀(폐기) |
| **C** | **그래프확장+팩 max15** | **30.6k / 5 / 0.60** | **채택** |
| C' | 확장+팩 max25(튜닝) | 32.5k / 4 / 0.60 | max↑ 무효 |

**확정 결론:**
1. **그래프확장+claims팩 채택.** 토큰 −37%·tool_uses −64%(속도), 순수lexical의 recall 회귀를 관계확장으로 복구. 답 완성도 A급.
2. **`--max`는 12~15 고정.** max25로 넓혀도 recall 안 오르고(synthesizer가 주변 후보를 어차피 미인용) 팩만 비대(Q1 46.7k로 이득 소멸). **recall 상한은 후보수가 아니라 답의 실질 관련성이 정함.**
3. **recall의 진짜 레버 = 키워드 추출 품질**(엔티티 포함). Q1-C'가 ax-rollout 잡은 건 max 아닌 키워드 덕. → 오케스트레이터 키워드 추출에 **질의 엔티티·동의어 포함**이 핵심.
4. recall 지표(골든셋)는 C를 과소평가 — 누락 골든은 대개 주변적(위키정비 로그·오래된 daily). 답 자체는 완전.

**배선 파라미터**: `scope-expand.py expand … --top-seed 8 --max 15`(브리핑) / `--max 8`(조회). 키워드는 질의 주제어 + 엔티티 + 동의어 3~6개.

---

## rev1 참고 (폐기 — 아래 ①②③은 순수 lexical 안, recall 회귀로 대체됨)

## ① 결정적 사전스코프

### 1-1. search.py `--files` 집계 모드 추가

현재 search.py: 단일어 리터럴, `<파일>:<라인>:<매칭>` line단위 출력. 스코프엔 **파일단위 랭킹**이 필요.

추가 사양:
```
search.py --files "<term1>" ["term2" ...] [--root .] [--top N]
  - 각 term을 OR로 wiki/ 본문+aliases 리터럴(대소문자무시) 검색
  - 파일별 집계 → 정렬키 = (매칭된 distinct term 수 desc, 총 매치수 desc)
  - 출력(줄당 1파일): <distinct>/<총매치>\t<slug>\t<type>  (예: 3/12  source-ax-rollout-reply  source)
  - --top N: 상한(기본 8). fill 아님 — 매치 0인 파일은 제외. 구체 질의는 1~2개만 반환 정상.
  - 기존 무플래그 동작(line단위)은 그대로 보존(하위호환)
```
구현 노트:
- **정렬은 distinct-term 우선**(agy 리뷰 반영): 3키워드 중 3개 맞은 짧은 문서가, 1키워드만 12번 맞은 긴 문서(템플릿 등)보다 상위. 단순 매치수 정렬의 길이 왜곡(TF-IDF 부재) 완화.
- **--top은 상한이지 채움 목표 아님**: score>0 파일만 포함 → 구체 질의는 노이즈 없이 소수, 광역은 최대 8. (agy: 고정 컷오프 양면성 완화)
- **aliases도 검색**: frontmatter `aliases:` 포함 → 동의어 매칭률↑(grep semantic gap 부분 완화). 근본 동의어 문제는 키워드 추출(§1-2)에서 변형어 다중 투입으로 보강.
- slug = 파일명에서 `.md` 제거. type = frontmatter `type:` (없으면 경로 추정).
- 다중어: `q.split()` 아닌 **인자 배열**로 받아 공백 포함 구 검색 가능.
- 크로스플랫폼: 기존 utf-8-sig·errors=replace·stdout.reconfigure 패턴 유지.
- 대상: `root/wiki` 하위(= index.md·log.md 루트 파일은 애초 스코프 밖 — ②와 정합). L1~L4·moc 포함, 랭킹으로 걸러짐.

### 1-2. 오케스트레이터가 사전스코프 실행

wiki-ops Query 흐름에 단계 삽입:
1. **키워드 추출(명시 단계 — agy 리뷰 반영)**: 자연어 질의를 grep에 그대로 넣지 마라(형태소 불일치로 매칭률↓). 오케스트레이터가 **핵심 엔티티·주제어 2~4개 + 변형·동의어**를 뽑는다(예: "교육"→`교육`·`강의`·`커리큘럼`; "토큰 줄이기"→`토큰`·`비용`·`최적화`). 이 소량 추출만 LLM(≈수백 토큰), 검색 자체는 0.
2. `python3 .claude/skills/wiki-lint/scripts/search.py --files "<kw1>" "<kw2>" … --top 8` 실행(토큰 0).
3. 출력 slug 목록(score>0만)을 synthesizer 프롬프트에 **"우선 read 후보"** + **스코프 신뢰도**(후보 수·distinct 커버리지)와 함께 전달.
4. 후보가 빈약(<2)하거나 광역 질의면 fallback(§② 참조).

---

## ② index.md 통독 폐지

### 2-1. wiki-query 절차 1 "탐색" 개정

현재(SKILL.md 절차 1): `index.md → 관련 moc → L3 순. 애매하면 search.py`.

개정:
- **기본 경로**: 오케스트레이터가 넘긴 **사전스코프 후보 slug만** 정독. index.md·MoC 통독 안 함.
- **fallback(후보 부족·광역 질의)**: `search.py --files`에 키워드 변형 추가해 1회 재호출 → 그래도 부족하면 관련 **MoC 1개**만 열람. **MoC 선택은 `ls wiki/moc/`(파일명만, 0토큰)에서 질의어와 파일명 매칭으로 고른다 — index를 읽지 않는다**(agy 리뷰: fallback이 index를 도로 읽으면 ②와 충돌). MoC 파일명은 자기설명적(ax-rollout-moc·rag-moc·hr-recruitment-moc…)이라 파일명 매칭으로 충분.
- index.md는 **린트·감사·카탈로그 갱신** 전용(질의 경로에서 read 금지).
- **전제(agy 리뷰: index 맥락 유실 우려)**: 이 위키의 index.md는 **평평한 카탈로그**(`- [[slug]] — 설명 (confidence)` 라인, 페이지 간 관계·계층 정보 없음)다. 관계·의존성은 각 페이지 `## 관계` 섹션과 MoC가 보유 → index를 빼도 관계형 질의("A↔B 의존성")는 후보 페이지의 관계 섹션·MoC로 답 가능. index가 관계 정보를 담는 위키였다면 이 설계는 재검토 대상(현 위키는 아님, 검증됨).

### 2-2. wiki-synthesizer 에이전트 원칙 보강

`## 작업 원칙`에 한 줄: "질의 시 index.md를 통독하지 않는다 — 오케스트레이터가 넘긴 후보 slug를 정독하고, 부족하면 search.py로 좁혀 추가 확보한다(광역 스윕 금지)."

---

## ③ 오케스트레이터 프롬프트 슬림

### 3-1. wiki-ops 질의 라우팅 규칙 보강

현재 오케스트레이터(방금 세션 포함)가 후보 ~10개 [[페이지]]를 프롬프트에 나열 + 장문 지시 → 입력토큰↑·전부 통독 유도·장문 출력 유도.

규칙 추가(SKILL.md 질의 라우팅 블록):
- **후보는 나열 아닌 사전스코프 결과(slug 목록)로 전달.** 페이지 내용 요약·해설을 프롬프트에 넣지 마라(synthesizer가 직접 읽는다 — 중복).
- **지시는 간결히**: 질의문 + 후보 slug + "부족 시 search 추가·환류 판단" 정도. 항목별 상세 탐색지시 금지.
- **출력 길이는 질의에 맞춘다**: "간단히"면 짧게. 매 답변 풀 브리핑·체크리스트 강제 금지.

### 3-2. 슬림 프롬프트 템플릿 (wiki-ops에 수록)

```
질의: "<사용자 질문 원문>"
우선 read 후보(사전스코프 search.py --files, distinct/총매치): <slug1>, <slug2>, … (score>0만)
스코프 신뢰도: <높음|낮음 — 후보 N개, distinct 커버리지 M>
- 이 후보를 정독해 근거 있는 답을 종합하라.
- ★스코프 신뢰도가 낮거나(후보<3) 답이 불완전하다고 느끼면, 반드시 키워드를 바꿔 search.py --files를 추가 호출해 더 확보하라(index 통독 금지). 후보가 전부가 아닐 수 있음을 전제하라.
- 각 주장에 confidence·출처([[slug]]) 병기. stale은 superseded_by 따라감.
- 답변 길이는 질문 범위에 맞춰라(불필요한 확장 금지).
- 재사용 가치 높으면(비교·분석·브리핑) type:query 파일링 제안.
```
> agy 리뷰(unknown-unknowns): synthesizer는 후보 8개만 봐서 "더 나은 문서가 있다"는 걸 모를 수 있음 → **스코프 신뢰도를 명시**하고 낮으면 추가 search를 **의무화**해 불완전 답변을 방지.

---

## 검증 계획

1. **기능**: `search.py --files "codex" "security" --top 5` → distinct/총매치 랭킹 출력 확인. 무플래그 기존 동작 보존 확인(회귀). 구체어 1개 질의 → 소수 반환(패딩 없음) 확인.
2. **e2e 지표(누적)**: 대표 2질의 재실행 → tool_uses·subagent_tokens 기록. **subagent_tokens는 end-to-end 누적값**이라 추가 search로 인한 멀티턴 누적(agy 지적)까지 이미 포착 — 이 값으로 baseline(19/61.8k, 12/52.4k) 대비 감소율 측정. 목표 read ≤6·index read 0·토큰 ≥30%↓.
3. **recall(골든셋)**: 기존 두 답변이 인용한 핵심 근거 페이지 집합을 **골든셋**으로 고정 → 사전스코프 후보가 이를 포함하는지(포함률) 측정. 누락 시 키워드 변형 추가·--top 상향. (agy: 정량 recall 기준)
4. **품질**: 재실행 답변이 신뢰도 병기·인용·stale 회피·환류 판단을 유지하는지 골든셋 인용 대비 정성+누락율 확인.

## 롤백

스킬 문서·search.py 변경뿐(에이전트 로직 파괴 없음). 문제 시 해당 커밋 revert로 즉시 원복. search.py는 신규 플래그라 기존 호출 무영향.

## 배포

리뷰 → 외부리뷰(agy) → 통과 시 커밋/PR/릴리즈(patch 또는 minor — 질의 흐름 변경이라 minor 후보). 릴리즈 후 대표 질의로 실측 보고.

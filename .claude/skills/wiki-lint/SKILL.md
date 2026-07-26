---
name: wiki-lint
description: How to health-check the LLM wiki (v2) — run link-audit + decay scripts, audit confidence/supersession, then drive consolidation (L2→L3→L4 promotion) and reason about contradictions, stale claims, missing pages/cross-references. Produces a prioritized fix list. Use for wiki lint/점검/health check/정리/orphan/broken link/망각/신뢰도 검사.
---

# wiki-lint (v2)

위키 건강 검진. **싼 결정적 검사 먼저, 비싼 추론·통합 나중.**

## 1단계: 결정적 검사 (스크립트 — LLM 토큰 0)

```bash
# 링크: 끊긴 wikilink + 고아 + 누락 타겟 집계 (L3/L4/moc 대상)
python3 .claude/skills/wiki-lint/scripts/link-audit.py . --json
#   broken       : 대상 없는 wikilink (page,target 중복 제거)
#   orphans      : inbound 0 페이지 (진짜 고아)
#   stub_targets : 없는 페이지를 가리키는 링크를 inbound(참조 페이지 수)순 집계
#                  → 여러 페이지가 가리키는 스텁 = 누락 개념 최우선 작성 후보 (5단계와 연결)
# 망각: Ebbinghaus 보존율, faded(R<0.3)/aging 페이지
python3 .claude/skills/wiki-lint/scripts/decay.py --scan . --json
# 본문 검색 (필요 시)
bash .claude/skills/wiki-lint/scripts/search.sh "<query>"
```

## 2단계: 망각 처리 (forgetting)
`decay.py`의 **faded** 페이지(R<0.3, status≠stale):
- 여전히 유효하면 → 재확인: `last_confirmed: 오늘`으로 갱신(리셋). 새 근거 있으면 sources·confidence도.
- 낡았으면 → **아카이브 후보로 제안**(status: stale 또는 L2로 강등). **자동 삭제 절대 금지** — 사용자 승인.
- decay_class가 잘못됐으면(중요한데 transient) 교정 제안.

## 3단계: 신뢰도·덮어쓰기 감사
- **신뢰도 재계산**: `sources:` 개수·유형으로 `confidence.py` 재실행, frontmatter와 불일치하면 교정.
- **supersession 정합**: `superseded_by`↔`supersedes` 양방향 링크가 짝맞는지, stale 페이지가 새 페이지를 가리키는지 확인. 짝 없는 stale·끊긴 대체 링크 보고.
- **저신뢰(confidence<0.6)** 주장은 근거 보강(새 소스 인제스트) 제안.

## 4단계: 통합 승격 (consolidation)
`wiki-consolidate` 스킬 절차로:
- **L2→L3**: `list-claims.sh`로 L2 주장 수집 → 같은 주장 3회+ 등장분을 L3 fact로 승격 후보(모순 있으면 보류).
- **L3→L4**: 같은 절차 2회+ 관찰분을 L4 procedure로 추출 후보.
승격은 후보로 제안, 승인 후 반영.

## 5단계: 추론 검사 (스크립트가 못 잡는 것)
- **모순.** 페이지 간 상충 → 삭제 말고 병기(supersession 아니면 `> [!warning] 상충`).
- **낡은 주장.** 새 소스가 뒤집었는데 stale 미표기 → supersession 처리 제안.
- **누락 개념.** `link-audit`의 `stub_targets`에서 inbound 많은 스텁(여러 페이지가 가리킴) → 생성 최우선 후보. 본문에서 언급만 되고 링크도 없는 개념도 찾는다.
- **빠진 교차참조/관계.** 관련 페이지쌍의 `[[ ]]`·`## 관계` 누락.
- **데이터 공백.** 웹 검색·새 소스로 메울 구멍 → 인제스트 후보.

## 6단계: 보고
심각도 정렬 수리 목록:
1. 끊긴 링크·모순·짝 없는 supersession (정확성)
2. faded 페이지·낡은 주장·고아 (신뢰성/발견성)
3. 승격 후보·누락 개념·빠진 관계 (완결성/성장)

조사할 새 질문·찾을 새 소스도 제안. 수리 반영 시 `updated`·해당되면 `last_confirmed` 갱신, log에 `## [오늘] lint | <요지>` append(자동화 훅이 이 항목으로 경과일 계산 — 반드시 남긴다).

## 원칙
**제안 먼저, 자동 수정 금지.** 삭제·병합·강등·대규모 재작성은 승인 후. 안전 수정(짝 링크 추가, 신뢰도 숫자 교정, last_confirmed 리셋)만 승인받아 적용. 스크립트가 링크·망각·신뢰도를 공짜로 계산하니, LLM 예산은 의미 검사(모순·승격 동치 판단)에 쓴다.

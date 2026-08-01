---
name: wiki-ops
description: Orchestrator for operating this Obsidian vault as an LLM wiki (v2 — tiered memory). Routes vault work to the right specialist — ingest a source, query the wiki, lint/health-check, maintain MoC navigation, or consolidate memory (L1→L2→L3→L4). Use for any wiki operation — "소스 인제스트/파일링", "위키에 질문", "위키 점검/린트", "MoC 갱신", "세션 종료/L1 압축/통합/승격", and follow-ups like "다시 실행/재실행/업데이트/보완/이전 결과 기반으로". 위키 내용을 묻는 질문은 wiki-synthesizer로 위임(브리핑·보고·종합 포함) — 하네스 사용법·단일값 조회 같은 사소한 것만 직접 응답.
orchestrates: [wiki-ingestor, wiki-synthesizer, wiki-linter, wiki-cartographer, wiki-consolidator]
---

# wiki-ops — LLM 위키 오케스트레이터 (v2)

이 볼트를 LLM 위키로 운영한다. 3계층 저장(raw 소스 · wiki 4계층 기억 · CLAUDE.md 스키마)과 4+1 오퍼레이션(ingest · query · lint · moc · consolidate)을 조율한다.

**실행 모드: 전문가 풀 (서브 에이전트 디스패치).** 오퍼레이션마다 전문가 1명 호출 — 동시 협업 팀 아님. 한 소스 인제스트는 교차참조·신뢰도 일관성을 위해 **단일 에이전트**가 통째로 처리. 작은 작업은 오케스트레이터(메인)가 직접 처리 가능.

## 4계층 기억 (v2)
```
raw/  →  L1-working  →  L2-episodic  →  L3-semantic  →  L4-procedural
소스     세션 스크래치   세션·소스 증거    사실·엔티티(신뢰도)  절차 steps
```
정보는 반복·시간·신뢰도로 차등되어 위로 승격한다. 상세는 `wiki-consolidate` 스킬.

## Phase 0: 컨텍스트 확인 (항상 먼저)
1. 볼트 구조 확인: `raw/`, `wiki/L1–L4`, `wiki/moc`, `index.md`, `log.md`. 없으면 초기 스캐폴딩 — 사용자에게 알림.
2. 자동화 상태 점검:
   ```bash
   python3 .claude/skills/wiki-lint/scripts/lint-due.py . 3
   ```
   `DUE <days>` → lint 권함. `L1:<n>`이 0 아님 → L1 미압축(세션 종료 시 consolidate 필요).
   ```bash
   python3 .claude/skills/wiki-lint/scripts/ingest-status.py .   # 미인제스트 raw 소스 (pending)
   ```
   `pending > 0` → raw/에 아직 인제스트 안 된 소스 있음.
3. 최근 이력: `grep "^## \[" log.md | tail -5`.
4. 실행 모드 판별: 신규 소스→ingest / 질문→query / 점검→lint / MoC→moc / 세션종료·압축·승격→consolidate / "이전 결과 기반·부분 수정"→해당 부분만 재작업.

## 라우팅
| 사용자 의도 | 전문가 | 스킬 |
|---|---|---|
| 소스 인제스트·파일링 | `wiki-ingestor` | wiki-ingest (+wiki-moc, confidence.py) |
| 위키에 질문·비교·분석 | `wiki-synthesizer` | wiki-query |
| 위키 점검·린트·망각·신뢰도 | `wiki-linter` | wiki-lint (+wiki-consolidate, decay.py) |
| MoC 생성·갱신·네비 정리 | `wiki-cartographer` | wiki-moc |
| 세션 종료·L1 압축·L2→L3→L4 승격 | `wiki-consolidator` | wiki-consolidate |

호출: `Agent(subagent_type="<전문가>", prompt="<작업+대상>")`. 오래 걸리면 `run_in_background: true`. 결과는 반환값 수집.

## 오퍼레이션 흐름
**Ingest:** 소스 확인 → `wiki-ingestor`(L2 증거 페이지 + L3 통합 + 신뢰도 + 덮어쓰기 + 관계) → 새 L3 페이지 MoC 편입 → index·log 확인 → **비용 기록**(아래) → 신뢰도·대체 포함 보고.

**Query:** **사전스코프(0토큰) → 팩 → `wiki-synthesizer` 종합** → 환류 가치면 파일링 → log. **모델: 기본 sonnet** — 깊은 비교·다소스 종합만 `model: opus` override. 정본 query 페이지 있으면 재종합 말고 참조.

> **사전스코프 배선 (v0.8.4 — index 통독 폐지, A/B 4라운드 실측 채택).** 위키 내용 질의는 오케스트레이터가 **먼저 결정적 스코프**를 만들어 synthesizer에 팩으로 넘긴다:
> 1. **키워드 추출** — 질의에서 주제어 + **엔티티** + 동의어 3~6개(엔티티 포함이 recall의 진짜 레버 — 실측). 자연어 그대로 grep 금지.
> 2. `python3 .claude/skills/wiki-lint/scripts/scope-expand.py expand "<kw>" … --top-seed 8 --max 15` (브리핑) 또는 `--max 8`(단일조회). lexical seed→관계 1홉 확장, 0토큰.
> 3. `scope-expand.py pack <후보 slug…>` → claims 컨텍스트 팩(1파일).
> 4. synthesizer에 **팩 파일 경로 + 후보 목록**만 전달(내용 요약·나열 금지 — 슬림). "팩 먼저 읽고, 불충분분만 개별 full-read, **index 통독 금지**".
> - **`--max`는 12~15 고정.** 넓혀도 recall 안 오르고(synthesizer가 주변 후보 미인용) 팩만 비대 — 실측 확인. recall은 max 아니라 **키워드 품질**로 올린다.
> - 라우팅: 단일사실 조회는 `--max 8`(팩 소형)·경량. 포괄 브리핑·비교는 `--max 15`.

> **질의 라우팅 규칙 (인라인 우회 금지).** 위키 내용을 근거로 답하는 질문은 **원칙적으로 `wiki-synthesizer`에게 위임**한다. 오케스트레이터가 grep으로 직접 종합하지 마라 — 그러면 신뢰도 병기·환류·index→MoC 탐색이 빠진다.
> - **인라인 직접 응답 허용(예외):** 위키 근거가 필요 없는 것 — 하네스 사용법·메타 질문, 방금 대화 맥락 확인, 단일 값 조회(예: "지금 pending 몇 개?"는 스크립트 1회).
> - **반드시 wiki-synthesizer로:** 여러 소스/페이지를 종합하는 질문, 브리핑·보고·비교·분석, "무엇을 했나/뭐가 있나/누구에게 보고" 류. 이런 답은 **환류 가치가 높으니** 답변 후 위키 페이지로 파일링을 제안·반영한다(유형은 wiki-query가 판단 — 개념·사실이면 `type: concept`, 시점 종속 보고면 `type: query`).
> - 판단 애매하면 **위임이 기본**.

**Lint:** `wiki-linter`(스크립트: link-audit+decay → 망각 처리 → 신뢰도·supersession 감사 → 통합 승격 후보 → 추론 검사 → 심각도 목록) → 승인분만 반영 → lint 항목 log 필수(자동화 경과일 계산 근거).

**MoC:** `wiki-cartographer`(허브 생성/갱신·L3/L4 편입·도달성 점검).

**Consolidate:** `wiki-consolidator`. **세션 종료 시** L1→L2 압축(3–5줄, L1 비움). **lint 중** L2→L3(주장 3회+)·L3→L4(절차 2회+) 승격 후보.

## 세션 종료 루틴
세션을 마칠 때(사용자가 종료 신호 또는 Phase 0에서 `L1:>0` 감지): `wiki-consolidator`로 L1→L2 압축 제안. `lint-due`가 `DUE`면 lint도 권함. 자율 모드(`.autonomous` 마커)면 압축 자동 실행.

## 데이터 전달 프로토콜
- **반환값 기반**(전문가 결과) + **파일 기반**(위키 자체가 영속 산출물 — `_workspace/` 불필요).
- 위키 파일이 곧 산출물·감사 추적. 큰 lint 리포트는 대화 보고, 남기라면 L3에 `type: query`로 저장.

## 에러 핸들링
- 전문가 실패 시 1회 재시도, 재실패면 그 부분 없이 진행·명시.
- 상충 데이터 삭제 금지 — 병기 또는 supersession(이력 보존).
- 소스 못 읽음 → 부분 인제스트로 위키 오염 금지, log 기록.

## 비용 원장 (v2 비용대비효과 측정)
매 인제스트 후 **오케스트레이터가** `metrics/ingest-cost.csv`에 1행 append한다 — **서브에이전트는 자기 토큰을 못 보므로 반드시 오케스트레이터가 기록**(Agent 결과의 `<usage>` 블록에서 tokens·tool_uses·duration을 읽고, 에이전트 보고에서 l3_new·l3_merged·moc_new를 읽어 채운다).
- 컬럼: `date,source_slug,source_kind,source_lines,tokens,wasted_tokens,tool_uses,duration_s,l3_new,l3_merged,moc_new,notes`
- 스톨·재시도 발생 시 낭비 토큰은 `wasted_tokens`에 별도 기록(효율 왜곡 방지).
- 리포트: `python3 metrics/cost-report.py` — 페이지당·소스100줄당 토큰, 낭비율, 총계. v2 도입 효과를 이 지표로 추적한다.

## 운영 규칙 (P2·P3 — v0.6)
- **신뢰도 하드코딩 금지.** 인제스트·lint·병합 프롬프트에 confidence 숫자(0.85 등)를 지정하지 마라 — 언제나 `confidence.py` 결과가 정본. (과거 오케스트레이터가 0.85로 지시 → 스크립트가 verbal 페널티로 0.75 교정한 사례.)
- **짧은 소스는 배치 인제스트.** 메일·데일리처럼 짧은 동종 소스가 여럿 pending이면 **한 번에 묶어** 인제스트(스킬로딩·concept-index·부기 고정비 상각). 소스당 개별 스폰은 짧을수록 페이지당 토큰이 폭증.
- **인라인 인제스트도 원장 기록.** 오케스트레이터가 에이전트 없이 직접 처리한 인제스트(예: 데일리)도 `metrics/ingest-cost.csv`에 기록 — 측정 정합(누락 시 통계 왜곡).
- **concept-index 필터.** 위키가 커지면 `concept-index.py . <키워드…>`로 소스 주제 관련분만 봐서 카탈로그 덤프를 바운드.
- **MoC 남발 억제 → cartographer.** 신규 MoC는 최소화(기존 우선). 주제 MoC가 12개 넘으면 SessionStack 알림 → `wiki-cartographer`로 그룹 재구성.
- **미해결 항목은 확인 큐로.** 사람 판단이 필요한 것(동일성·상충 등)은 `_workspace/needs-confirm.md`에 `- [ ] <항목>`으로 적재 — SessionStart가 리마인드.

## 규약 정본
페이지 명명·frontmatter·신뢰도·덮어쓰기·망각·관계는 `CLAUDE.md`가 정본. 모든 전문가가 따른다.

## 후속 작업
- 같은 소스 재인제스트 → 기존 페이지 갱신(신규 금지), 소스 추가로 신뢰도 상승.
- "MoC만/이 페이지 린트만/L1 압축만" → 해당 전문가만 부분 호출.
- 직전 lint 리포트 있으면 해결분 제외 신규/미해결만.

## 테스트 시나리오
**정상 (ingest→consolidate):** `raw/attention.md` 인제스트 → `wiki-ingestor`가 `L2-episodic/source-attention.md`(claim:: 표기) + `L3-semantic/entity-transformer.md`(confidence 0.6, 소스 1) 생성 + `## 관계` → MoC 편입 → index·log. 이후 같은 주장이 세 소스에서 확인되면 lint 중 `wiki-consolidator`가 confidence 0.95로 갱신·last_confirmed 리셋. 검증: link-audit broken 0, confidence.py 값 일치.

**에러 (덮어쓰기 충돌):** 새 소스가 기존 fact를 뒤집음 → `wiki-ingestor`가 옛 페이지 삭제 아니라 `status: stale`+`superseded_by`, 새 페이지 `supersedes`, 양방향 링크. 검증: lint의 supersession 감사에서 짝 링크 정합 PASS, 이력 보존.

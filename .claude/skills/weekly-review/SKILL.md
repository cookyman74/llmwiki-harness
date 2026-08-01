---
name: weekly-review
description: 주간 리뷰 자동 생성 — 이번 주 위키(세션·소스·query·회의·메일)를 종합해 완료·미결·stale·다음주 우선순위를 담은 다이제스트를 만들고 query 페이지로 파일링한다. 매주 금요일 또는 "주간 리뷰/이번주 정리/주간 보고" 요청 시 사용. 이정호 보고 초안에도 활용.
disable-model-invocation: false
---

# weekly-review — 주간 리뷰 자동 생성

이번 주 축적된 위키를 종합해 **"몇 시간→몇 분"** 주간 리뷰를 만든다. 회고·다음주 계획·상급자 보고 초안의 공통 뼈대.

## 절차

1. **기간 확정.** 오늘 기준 이번 주(월~금) 범위. 오늘 날짜 확인.

2. **사전스코프(0토큰).** 이번 주 관련 페이지를 그래프확장으로 모은다:
   ```bash
   python3 .claude/skills/wiki-lint/scripts/scope-expand.py expand \
     주간 회의 보고 자동화 <이번주 주요 주제·엔티티…> --max 22 --rerank 14 > /tmp/wr_cands.txt
   python3 .claude/skills/wiki-lint/scripts/scope-expand.py pack $(cat /tmp/wr_cands.txt | cut -f3) > /tmp/wr_pack.md
   ```
   최근성 우선: `session-*`·`source-*`·`query-*` 중 created/updated가 이번 주인 것. 애매하면 `search.py`로 날짜 grep.

3. **wiki-synthesizer로 종합.** 팩을 근거로 아래 4블록 다이제스트:
   - **완료** — 이번 주 관찰된 산출·진행(근거 인용).
   - **미결(open loops)** — 답변/확인 대기, 진행상태 gap("기록 없음" 명시).
   - **stale/리스크** — 지연 프로젝트, faded 페이지, 상충.
   - **다음주 우선순위** — 마감·베타·보고 임박 순.
   각 항목 confidence·출처([[slug]]) 병기. 시점 종속이라 "차주"는 절대날짜로 해석.

4. **환류(파일링).** `wiki/L2-episodic/query-weekly-review-YYYY-MM-DD.md`:
   - `type: query`, `decay_class: episodic`, sources·last_confirmed 부여, 관련 MoC(ax-rollout 등) 편입.
   - log.md에 `## [오늘] query | 주간 리뷰 <주차>` append.
   - 이미 이번 주 주간리뷰가 있으면 재작성 말고 갱신.

5. **보고.** 4블록 요약을 대화로 출력 + 파일 경로. 상급자 보고 필요하면 "보고 초안" 톤으로 재정리 제안.

## 예약(스케줄)
- Claude Code 세션 내에서는 `CronCreate`로 금요일 예약 가능하나 **세션 한정**(재시작 시 소멸·7일 만료). 영속 자동화는 OS cron/CI에서 `claude -p "/weekly-review"` 헤드리스 호출 권장.
- 수동: 매주 금요일 `/weekly-review` 트리거.

## 왜
주간 리뷰는 PKM의 킬러앱 — 완료·미결·stale·우선순위를 한 장으로. 위키에 이미 세션 압축·query 환류가 쌓이므로 재종합이 싸다(라우팅+팩). 결정 연속성·상급자 보고·회고를 한 번에.

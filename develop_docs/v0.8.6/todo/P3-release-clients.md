# P3 — 배포·클라이언트 매트릭스: README · 규칙 스니펫 · npm publish · 실측 · 릴리즈

```
status: not-started        # not-started | in-progress | review | done
started:
completed:
external_review:           # pending | done → review/P3-agy-YYYY-MM-DD.md
```

- 근거: `../DESIGN.md §8`(등록 매트릭스), `§9`(배포·버전·롤백), `§12`, `../PRD.md §1 대상 클라이언트 표, §3 지표, §6 인수 조건`
- 선행 조건: **P2 done**
- 완료 표시 방법: `00-README.md` 규칙. 클라이언트 실측 항목은 **호출 순서 로그 파일 경로**를 근거로 남긴다(`todo/evidence/P3-<client>.log`)

## 체크리스트

### A. 문서
- [ ] P3-01 `tools/llmwiki-mcp/README.md` — 설치(사전 설치물: Node ≥20만), 등록 매트릭스 8종(§8 그대로), Windows `cmd /c`, Codex `startup_timeout_sec`, `npm i -g` 대안, 도구 4개 계약, 라우팅 표, 한계(OneDrive 지연·심볼릭 링크 무시·NFC 미정규화·읽기 전용·HTTP 없음)
- [ ] P3-02 `templates/mcp-client-guide.md` — 원본 규칙 스니펫(라우팅 표 + 규약 3줄 + "파일링은 볼트 wiki-ops"), 20줄 이내
- [ ] P3-03 파생 스니펫 4종 — `templates/clients/claude-skill/SKILL.md`, `codex-AGENTS.md`, `gemini-GEMINI.md`, `cursor-llmwiki.mdc` (내용은 P3-02 에서 생성·동일성 테스트)
- [ ] P3-04 agy 규칙 체계 확인 — 스킬/플러그인 파일 위치를 조사해 가능하면 파생 추가, 불가하면 "서버 자기서술만" 으로 기록
- [ ] P3-05 저장소 `README.md`(하네스) 에 MCP 서버 절 추가 — 존재·목적·링크 (상세는 패키지 README)
- [ ] P3-06 `CLAUDE.md` 변경 이력 행 + 동기 규칙 1줄("리트리벌 규칙 변경은 Python·TS·픽스처 3점을 한 PR 에서")

### B. npm 배포
- [ ] P3-07 `npm pack --dry-run` — `dist/`, `README.md`, `package.json`, `LICENSE` 외 0개, 콘텐츠 `.md` 0개
- [ ] P3-08 `npm publish --access public` `llmwiki-mcp@0.1.0` — 2FA·소유 계정 확인, publish 로그 보관
- [ ] P3-09 새 셸에서 `npx -y llmwiki-mcp@0.1.0 --selftest --root <볼트>` 성공(캐시 없는 상태 → 콜드스타트 시간 기록)
- [ ] P3-10 콜드스타트·웜스타트 시간 → README 의 Codex `startup_timeout_sec` 권고값 확정

### C. 클라이언트 매트릭스 실측 (필수 5종)
각 항목: 등록 1줄 → `tools/list` 확인 → 사실브리핑 질의 1건("<위키 주제>에 대해 정리해줘") → 호출 순서 로그(`LLMWIKI_DEBUG=1` stderr) 저장 → 답에 confidence 병기 여부 확인.
- [ ] P3-11 **Claude Code**(볼트 외 다른 프로젝트 디렉터리) — `claude mcp add --scope user …` — 로그 `evidence/P3-claude-code.log`
- [ ] P3-12 **Codex CLI** — `codex mcp add llmwiki -- npx -y …` (+ 타임아웃 설정) — `evidence/P3-codex.log`
- [ ] P3-13 **Gemini CLI** — `~/.gemini/settings.json` 또는 `gemini mcp add` — `evidence/P3-gemini.log`. 스키마 거부 여부 별도 기록
- [ ] P3-14 **agy** — `agy mcp add llmwiki -- npx -y …` — `evidence/P3-agy.log`
- [ ] P3-15 **Cursor** — `~/.cursor/mcp.json` (`env.LLMWIKI_ROOT` 방식) — `evidence/P3-cursor.log`
- [ ] P3-16 추가 1종 — Claude Desktop / VS Code(`servers` 키) / Windows(`cmd /c`) 중 택1 — `evidence/P3-extra.log`
- [ ] P3-17 각 클라이언트에서 `print-config --client <x>` 출력을 **그대로** 사용해 등록됐는지 확인(출력 문법 검증)

### D. 라우팅 준수율 (규칙 스니펫 없는 상태)
- [ ] P3-18 Claude Code·Codex·Gemini 3종 × 사실브리핑 질의 3건 = 9회 — `wiki_pack` 이전 `wiki_read_page` 호출 0회, 팩 후 read_page ≤1 (로그 집계 `evidence/P3-routing.csv`)
- [ ] P3-19 미달 클라이언트가 있으면 해당 규칙 스니펫(P3-03) 설치 후 재측정, 결과 병기
- [ ] P3-20 절차 질의 2건 × 3종 — `wiki_expand(max=8)` → `wiki_read_page` 경로로 가는지 확인

### E. 볼트 연동 확인
- [ ] P3-21 볼트 하네스(`wiki-query`·`wiki-ops`) 무변경 확인 — 볼트 `.claude/` 에 MCP 관련 파일 미설치
- [ ] P3-22 볼트 안 Claude Code 에서 기존 Python 경로 질의 1건 정상(회귀 없음)

### F. 릴리즈
- [ ] P3-23 PR 머지 후 `git tag v0.11.0` + 릴리즈 노트 — 패리티 결과(`--vault` 포함)·클라이언트 매트릭스 결과·콜드스타트 수치·외부리뷰 파일 링크
- [ ] P3-24 `tests/parity.py --vault` 실행 결과 릴리즈 노트에 1줄
- [ ] P3-25 롤백 절차 확인 — `claude mcp remove llmwiki` 등 클라이언트별 제거 명령 README 에 수록, npm `deprecate` 절차 기록

### 이월 항목 (P2 외부리뷰에서 P3 로)
- [ ] P3-26+ (codex P2 1차 M8·2차) 클라이언트 5종 실측은 P3-11~17 이 그 자체 — 실측 시 `tools/list` 스키마 수용 여부(integer·enum·minLength)와 `structuredContent` 미지원 클라이언트의 text-only 동작을 로그에 남긴다
- [ ] P3-27+ (codex P2 2차 #8) 독립 JSON Schema 검증기(ajv, devDependency)로 `review/P2-tools-list.json` 의 스키마 자체와 4도구 샘플 응답을 교차 검증하는 테스트 추가
- [ ] P3-28+ (agy P2 2차 m5) `TOOLS` outputSchema ↔ TS 타입의 정적 연결(단일 소스 생성 또는 인터페이스 강제)
- [ ] P3-29+ (codex P2 2차 #6) Windows 실제 셸(cmd.exe·PowerShell)에서 `print-config --windows` 출력으로 등록이 되는지 매트릭스 1종에서 실측(`%`·`&`·공백 경로)
- [ ] P3-30+ (codex/agy NFC) README 한계에 macOS NFD 파일명 vs NFC 질의 불일치·대소문자 무시 FS 동작을 명시(P3-01 에 포함)

## 산출물
- 패키지 README, `templates/mcp-client-guide.md` + 파생 4종, npm `llmwiki-mcp@0.1.0`, `evidence/P3-*.log`, `P3-routing.csv`, 태그 v0.11.0

## 완료 기준 (DoD)
- [ ] 필수 5종 클라이언트 + 추가 1종 실측 통과, 로그 보관
- [ ] 라우팅 준수율 지표 달성(또는 스니펫 설치 후 달성, 둘 다 기록)
- [ ] npm 패키지에 콘텐츠 0개, `npx` 콜드스타트 성공
- [ ] PRD §6 인수 조건 전 항목 체크
- [ ] 외부리뷰 완료 → 태그

## 외부리뷰 (단계 종료 시 필수 — 릴리즈 게이트)
- 대상: 패키지 README, 규칙 스니펫 5종, `evidence/` 로그·CSV, 릴리즈 노트 초안, `npm pack` 목록
- 관점: ① README 만 보고 처음 쓰는 사람이 각 클라이언트에 5분 내 설치 가능한가(문법 오류·누락) ② 실측 로그가 지표를 실제로 입증하는가(선별·누락 없이) ③ 콘텐츠·비밀 유출 — 패키지·README·로그·스크린샷에 볼트 내용이나 키가 없는가 ④ 롤백·제거가 클라이언트별로 완결되는가 ⑤ PRD 인수 조건 중 미충족을 "완료" 로 표시한 곳이 없는가
- 절차: `00-README.md` 규칙. 프롬프트 `review/P3-prompt.txt`, 결과 `review/P3-agy-YYYY-MM-DD.md`. **BLOCKER 0건 전에는 publish·태그 금지** (publish 는 되돌리기 어려움 → 리뷰를 P3-08 이전에 1차, 실측 후 2차로 나눠도 됨)

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| | | | | |

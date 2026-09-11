# 작업계획서 안내 — llmwiki MCP 서버 (Node.js 포팅)

- 근거 문서: `../PRD.md`, `../DESIGN.md` (외부리뷰 반영본, 2026-09-09)
- 작성일: 2026-09-09
- 단계 문서: `P0-*.md` ~ `P4-*.md` — **단계마다 문서 1개**, 체크리스트 형식

## 단계 개요와 게이트

| 단계 | 문서 | 목표 | 게이트(다음 단계 진입 조건) |
|---|---|---|---|
| P0 | `P0-prepare.md` | 스캐폴딩·Python 결정성 수정·픽스처 볼트 | smoke 통과 + 실볼트 수정 전후 출력 동일 + 외부리뷰 완료 |
| P1 | `P1-port-retrieval.md` | 리트리벌 4모드 TS 포팅 + 단위 + 패리티 CI | 픽스처 패리티 전건 통과 + CI 3-OS 녹색 + 외부리뷰 완료 |
| P2 | `P2-mcp-server.md` | MCP 서버·도구 4개·보안·CLI 서브커맨드 | Inspector 확인 + 보안 테스트 통과 + 외부리뷰 완료 |
| P3 | `P3-release-clients.md` | README·규칙 스니펫·npm publish·클라이언트 매트릭스 | 5종 필수 클라이언트 통과 + 준수율 지표 + 외부리뷰 완료 → 태그 v0.11.0 |
| P4 | `P4-cache-followup.md` | (후속) mtime 캐시 v1.1 | 패리티 on/off 동일 + 외부리뷰 완료 |

단계는 순서대로 진행한다. 게이트를 통과하지 못하면 다음 단계 문서의 체크박스를 열지 않는다.

## 완료 표시 규칙 (모든 단계 문서 공통)

1. **항목 완료**: `- [ ]` → `- [x]` 로 바꾸고 줄 끝에 ` ✅ YYYY-MM-DD` 를 붙인다. 근거(커밋 해시·테스트 출력 파일·스크린샷 경로)가 있으면 ` — <근거>` 를 이어 쓴다.
   - 예: `- [x] P1-03 bm25.ts 포팅 ✅ 2026-09-12 — a1b2c3d, test/unit/bm25.test.ts 통과`
2. **항목 보류/기각**: 체크하지 않고 ` ⏸ 사유` 또는 ` ✖ 기각 사유` 를 붙인다. 지우지 않는다.
3. **단계 상태**: 문서 맨 위 `status:` 를 `not-started → in-progress → review → done` 순으로 갱신하고 `started:`/`completed:` 날짜를 채운다.
4. **하위 항목 전부 완료 ≠ 단계 완료.** 단계 완료는 "완료 기준(DoD)" 섹션의 모든 항목 + 외부리뷰 완료가 조건이다.
5. 체크리스트 항목은 **추가는 허용, 삭제는 금지**. 추가 항목은 ID 뒤에 `+` (예: `P1-12+`).

## 외부리뷰 규칙 (단계 종료마다 필수)

각 단계 문서의 "외부리뷰" 섹션에 따라 수행한다. 공통 절차:

1. 단계 산출물이 DoD를 만족하면 `status: review` 로 바꾼다.
2. 리뷰 프롬프트를 `todo/review/P<n>-prompt.txt` 에 저장한다. 프롬프트에는 **리뷰 대상 파일 목록·검토 관점·출력 형식(BLOCKER/MAJOR/MINOR)·"파일 수정 금지"** 를 반드시 포함한다(v0.8.6 문서 리뷰에 쓴 형식 재사용 — `../REVIEW-agy-2026-09-09.md` 참조).
3. 외부 리뷰어로 실행한다. 기본은 `agy`, 가능하면 `codex` 로 2차 교차 리뷰:
   ```bash
   agy -p "$(cat develop_docs/v0.8.6/todo/review/P<n>-prompt.txt)" --mode plan --effort high \
       --dangerously-skip-permissions --print-timeout 9m > develop_docs/v0.8.6/todo/review/P<n>-agy-YYYY-MM-DD.md
   git status --short   # 리뷰어가 파일을 건드리지 않았는지 확인
   ```
4. 결과 파일을 `todo/review/` 에 보관하고, 단계 문서의 "외부리뷰 반영" 표에 **항목별 판정(수용/기각/상신)과 반영 위치**를 기록한다. 기각은 근거를 적는다(사실 검증 우선 — 예: v0.8.6 리뷰의 `structuredContent` 지적은 SDK 문서로 반증).
5. BLOCKER가 0건이 되고 MAJOR가 전부 판정되면 `status: done` 으로 바꾼다. 수용한 항목이 코드 변경을 요구하면 같은 단계 안에서 고치고 관련 테스트를 재실행한 뒤 완료한다.
6. 단계 PR은 외부리뷰 완료 후에 만든다. PR 본문에 리뷰 파일 경로와 반영 요약을 넣는다.

## 근거 파일의 위치와 공개 범위 (2026-09-09 P0에서 확정)

- `todo/baseline/**`, `todo/evidence/**` 는 **로컬 전용 — `.gitignore` 로 커밋 차단**(`.gitkeep` 만 추적). 실 볼트 출력(pack 의 claims 본문·slug·로그)이 그대로 담기므로 공개 하네스 저장소에 올리면 콘텐츠가 유출된다(P0 baseline 의 pack 출력 1개가 21KB 실 콘텐츠였음).
- 체크리스트의 근거 표기는 이 로컬 파일을 가리켜도 된다. 단, PR·릴리즈 노트에는 **요약 수치만**(diff 0건, 통과 수, 시간) 적고 slug·본문을 인용하지 않는다.
- `todo/review/**` (외부리뷰 프롬프트·결과) 는 커밋한다. 리뷰 결과에 실 볼트 내용이 인용됐으면 커밋 전에 그 부분을 `[볼트 내용 생략]` 으로 치환한다.

## 공통 참조

- 정본 알고리즘: `.claude/skills/wiki-lint/scripts/search.py`, `scope-expand.py`
- 포팅 대응표: `../DESIGN.md §4` (#1~#21, #17b) — P1 단위 테스트 목록이기도 함
- 도구 계약·호환 규칙: `../DESIGN.md §3`
- 보안: `../DESIGN.md §5` · 패리티: `§7` · 등록 매트릭스: `§8`
- 성공 지표·인수 조건: `../PRD.md §3, §6`
- 커밋 규약: feature 브랜치 → PR → main, 커밋 메시지 끝 `Co-Authored-By` 유지. 하네스 변경 시 저장소 루트 `CHANGELOG.md`(하네스 변경 이력) 맨 아래에 행 추가 — 2026-09-11 에 `CLAUDE.md` 에서 분리.
- **볼트에는 설치하지 않는다.** 이 패키지는 볼트 밖 전용(`--root` 데이터). 단, P0의 Python 스크립트 수정은 볼트 `.claude/`에 설치(복사)해야 한다.

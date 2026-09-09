# v0.11.0 — llmwiki MCP 서버 (초안, 태그 전)

> **상태: 초안 — 배포 차단.** P3 외부리뷰(2026-09-09, codex)가 "배포 불가"로 판정했고 그 사유가 아래 "배포 전 남은 조건"에 있다. `npm publish` 와 `git tag v0.11.0` 은 그 조건 해소 + 사용자 승인 후에만 진행한다(P3-08·P3-23).

## 무엇이 생겼나

볼트 안 Claude Code만 쓰던 위키 리트리벌을 **MCP stdio 서버**로 노출했다. Codex CLI·Gemini CLI·agy·Cursor·Windsurf·Claude Desktop·VS Code, 그리고 직접 만든 MCP 클라이언트가 같은 위키를 읽는다. 설치는 등록 한 줄이고 사전 설치물은 Node ≥20 하나뿐이다.

```bash
npx llmwiki-mcp print-config --client codex --root /path/to/llmwiki.obsidian   # 등록 스니펫 생성
```

도구 4개: `wiki_expand`(진입점 — seed→관계 1홉→MoC, 옵션 BM25 rerank) · `wiki_pack`(claims·confidence·status·관계 팩) · `wiki_read_page`(전문 read) · `wiki_search`(fallback). 읽기 전용이며 파일링·인제스트·lint는 볼트 자체 하네스가 계속 담당한다.

## 구조

| 계층 | 내용 |
|---|---|
| 정본 | `.claude/skills/wiki-lint/scripts/{search,scope-expand}.py` — A/B 5라운드로 검증된 랭킹 규칙 |
| 포팅 | `tools/llmwiki-mcp/src/*.ts` — 같은 규칙의 TypeScript 구현 |
| 보증 | `tests/parity.py`(골든셋)·`tests/parity_fuzz.py`(차등 퍼징) — 두 구현이 같은 출력을 내는지 CI가 검사 |

리트리벌 규칙을 바꾸면 Python·TS·픽스처 3점을 한 PR에서 함께 고친다.

## 검증 결과

| 항목 | 결과 |
|---|---|
| 단위 테스트 | 37파일 491건 통과 |
| 패리티(픽스처 14질의 × 4모드) | FAIL 0 / GOLDEN DRIFT 0 |
| 패리티(실볼트 5질의 × 4모드) | 0/20 FAIL, 3회 반복 digest 동일 |
| 차등 퍼징 | 420/420 일치(seed 고정) |
| CI | smoke·parity × ubuntu·macOS·windows = 6/6 |
| 성능 | 실볼트 309페이지 그래프 구성 31~37ms · 합성 1,000페이지 50ms · MCP initialize 왕복 123ms · npx 콜드스타트 5.8s(캐시 비운 tarball 기준) |

## 클라이언트 실측 (P3)

| 클라이언트 | 등록 | 사실브리핑 라우팅 |
|---|---|---|
| Claude Code | `claude mcp add` 성공 | **준수** — `wiki_expand → wiki_pack`, 전문 read 0회, confidence 병기 |
| Codex CLI 0.153 | `codex mcp add` 성공 | **준수** — 사실 3/3 · 절차 2/2. 단 `codex exec` 는 기본 `approval: never` 라 MCP 도구가 차단되므로 비대화형에서는 `--approve-for-me` 가 필요하다 |
| agy 1.1 | `agy mcp add` 성공 | 미달 — 스니펫 설치 후에도 `wiki_search`→전문 read 를 선호(사실 0/3 · 절차 0/2). 1회 준수했으나 재현되지 않음 |
| Gemini CLI · Cursor · Windsurf · Claude Desktop · VS Code | 설정 스니펫을 실제 파일과 dry-merge로 검증 | 실사용 미확인(이 환경에 Gemini CLI 미설치, Cursor는 GUI) |

근거 로그는 `develop_docs/v0.8.6/todo/evidence/`(로컬 전용)에, 판정표는 같은 폴더 `P3-routing.csv`에 있다.

## 실측으로만 잡힌 것

- **Codex 등록 명령이 실제로는 실패했다.** `codex mcp add <name> -c mcp_servers.<name>.startup_timeout_sec=60 -- <cmd>` 는 "invalid transport"로 죽는다(`-c`가 command 없는 테이블을 먼저 만든다). 문자열 리뷰 3라운드가 놓쳤고 실행에서 드러났다. 플래그 없는 등록 + `config.toml` 안내로 고쳤다.
- **라우팅은 서버 설명만으로 완결되지 않는다.** 같은 서버·같은 설명인데 클라이언트마다 도구 선택이 달랐다. 진입점을 도구 목록 앞으로 옮기고 fallback·최후수단 문구를 강화해 개선했고, 그래도 미달인 클라이언트는 규칙 스니펫으로 해결한다.
- **Windows `%%` 이스케이프는 배치 파일 전용이다.** 대화형 cmd.exe는 큰따옴표 안에서도 `%VAR%`를 확장한다. `%`·`!`가 든 볼트 경로는 명령형 등록을 거부하고 JSON 설정형을 안내한다.

## 외부리뷰

P0~P2 각 단계마다 codex·agy 교차 리뷰를 돌렸고(총 10회), P3 리뷰는 1회(codex) 수행해 **배포 불가** 판정을 받았다 — 그 지적을 반영한 뒤 재리뷰가 필요하다. 검출·수정한 것 중 중요한 것: 볼트의 `wiki` 디렉터리가 심볼릭 링크일 때 외부 파일 유출, 구조화 응답이 200KB 상한을 우회, 읽기 전용 CI 가드의 별칭 import 우회, `fmt1` 거짓 tie, 이중 BOM, Python과 Node의 Unicode 버전 차이 55 코드포인트. 리뷰 원문과 판정표는 `develop_docs/v0.8.6/todo/review/` 와 각 단계 문서에 있다.

## 알려진 한계

macOS NFD 파일명과 NFC 질의가 어긋날 수 있다(Python 정본과 바이트 동일을 유지하려 정규화하지 않는다). 대소문자 무시 파일시스템에서는 다른 대소문자 slug가 해석될 수 있다. `wiki/` 안 심볼릭 링크는 건너뛴다. 클라우드 온디맨드 파일은 첫 read가 느리다. stdio 전용이며 HTTP는 없다. 그래프는 호출마다 재구성한다(캐시는 P4).

## 배포 전 남은 조건 (P3 외부리뷰 판정)

1. **라우팅 지표 미달** — 15회 측정 결과 Claude Code 5/5 · Codex 5/5 · agy 0/5(합계 10/15). 서버 결함이 아니라 agy 의 도구 선택 특성이다. 지표를 "CLI 3종 모두 준수"로 유지할지, "2종 준수 + agy 는 알려진 한계"로 조정할지 결정이 필요하다.
2. **필수 클라이언트 5종 중 2종 미검증** — 이 환경에 Gemini CLI가 없고 Cursor는 GUI다. 설정 스니펫은 실제 파일과 dry-merge로만 확인했다.
3. ~~Codex 재현성~~ — 해소됐다. 원인은 `codex exec` 의 기본 `approval: never` 였고 `--approve-for-me` 로 5/5 준수를 확인했다. README·클라이언트 가이드에 조건을 명시했다.
4. **Windows 실셸 미검증** — 등록 스니펫의 문법은 단위 테스트로 고정했지만 cmd.exe·PowerShell에서 실제 등록은 확인하지 못했다.

## 그 밖에 남은 작업

- `npm publish --access public` (조건 해소 + 승인 후) → `npx -y llmwiki-mcp@0.1.0` 재검증
- `git tag v0.11.0`
- P4: 프로세스 내 mtime 캐시(지연이 문제가 될 때만)

# llmwiki MCP 클라이언트 규칙 (원본 — 파생은 `templates/clients/`)

볼트 밖(다른 프로젝트)에서 위키 지식이 필요할 때만 `llmwiki` MCP 도구를 쓴다 — "위키에 뭐라고 돼 있나", "llmwiki 참고", 개념·사실·절차를 위키에서 확인할 때. 코드·파일 질문은 평소대로 처리한다.

## 라우팅

| 질의 유형 | 호출 순서 |
|---|---|
| 단일 조회 | `wiki_expand(max≤6)` → seed 결과로 바로 답 |
| 사실 브리핑·비교 | `wiki_expand(rerank=11)` → `wiki_pack` — claims로 충분하면 full-read 금지 |
| 절차·how-to | `wiki_expand(max=8)` → `wiki_read_page` |
| 후보 빈약(fallback) | `wiki_search` → 얻은 키워드로 다시 `wiki_expand` |

`wiki_expand` 응답의 `suggested_next`(`wiki_pack`·`wiki_read_page`·`answer`)가 다음 도구를 가리킨다 — 표와 어긋나면 `suggested_next`를 따른다.

## 규약

- **신뢰도 병기** — 팩·frontmatter의 `confidence`를 답의 각 주장에 함께 적는다(예: "confidence 0.85").
- **stale 추적** — `status: stale` 페이지는 주근거로 쓰지 말고 `superseded_by`를 `wiki_read_page`로 따라가 active 페이지를 우선한다.
- **읽기 전용** — 이 서버는 쓰지 않는다. 파일링·인제스트·린트는 볼트 자체 하네스(`wiki-ops`)에서 한다.

서버가 자기서술한다(도구 description + `suggested_next` + 서버 `instructions`) — 이 스니펫은 준수율 보조이며 없어도 동작해야 한다.

<!-- 아래 `## agy` 절은 조사 노트이며 파생 스니펫 본문에 포함되지 않는다. '20줄 이내' 기준은 **본문(파생 대상)** 에 적용된다. -->

<!-- Codex 비대화형: `codex exec` 는 기본 `approval: never` 라 MCP 도구가 차단된다 → `--approve-for-me` 를 붙여라(0.153.4 실측). -->

## agy

`~/.agents/skills/<name>/SKILL.md` (워크스페이스는 `.agents/skills/`) — 2026-09-09 로컬 확인. `agy --help`에 `--disable-slash-commands`("slash command and skill expansion"), 서브커맨드 `plugin`(list·import·install·validate)·`agents`가 있고, 바이너리 내장 문서가 스킬 경로를 `<workspace>/.agents/skills/<name>/SKILL.md`, 규칙 경로를 `AGENTS.md`·`GEMINI.md`·`.agents/rules/*.md`로 서술한다. `~/.agy`·`~/.config/agy`는 없다. 사용자(홈) 경로는 바이너리에 리터럴로 박혀 있지 않지만 `~/.agents/skills/`가 실제로 존재하고 `graphify` 스킬이 거기 설치돼 있다 — 즉 홈 경로는 실측 기반 추정이고, 워크스페이스 경로가 문서화된 정본이다. → 파생 추가: Claude용 `templates/clients/claude-skill/SKILL.md`를 그대로 `~/.agents/skills/llmwiki-query/SKILL.md`에 복사하면 된다(같은 frontmatter+본문 형식). `plugin import`는 gemini/claude 플러그인 가져오기이므로 스킬 1개 배포에는 불필요.

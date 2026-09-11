# obsidian-llmwiki-mcp 설치·사용 가이드

`obsidian-llmwiki-mcp`는 옵시디언 **LLM 위키 v2** 볼트를 **읽기 전용**으로 여는 MCP 서버입니다. 볼트 밖에서 일하는 에이전트 — 다른 저장소의 Claude Code, Codex CLI, Gemini CLI, agy, Cursor, Windsurf, Claude Desktop, VS Code — 가 위키를 통째로 다시 읽지 않고, 필요한 페이지와 주장(claim)만 골라 답할 수 있게 해 줍니다.

- 도구 4개(`wiki_expand` · `wiki_pack` · `wiki_read_page` · `wiki_search`)를 stdio 로 제공합니다.
- **쓰지 않습니다.** 파일 쓰기 API 가 코드에 없고(CI 가 검사), 네트워크 연결도 LLM 호출도 하지 않습니다. 인제스트·파일링·린트는 계속 볼트 안의 하네스(`wiki-ops`)가 합니다.
- **패키지 이름과 명령 이름이 다릅니다.** npm 패키지는 `obsidian-llmwiki-mcp`, 설치되는 명령은 `llmwiki-mcp` 입니다. `npx -y obsidian-llmwiki-mcp …` 는 그 명령을 바로 실행합니다.

> 영문 상세 레퍼런스(도구 계약·상한·보안 경계)는 [패키지 README](../README.md)에 있습니다. 이 문서는 한국어로 설치와 일상 사용에 필요한 것만 추렸습니다.

---

## 1. 준비물

| 항목 | 요구 |
|---|---|
| Node.js | **20 이상** — `node -v` 로 확인 |
| 볼트 | 아래 구조의 LLM 위키 v2 볼트(이 저장소 하네스로 운영하는 볼트) |
| Python | **필요 없습니다.** 저장소의 Python 스크립트는 정본 구현(패리티 테스트 기준)일 뿐 런타임 의존성이 아닙니다 |

서버가 읽는 곳은 `<볼트>/wiki/` 아래뿐입니다. `raw/`·`index.md`·`log.md`·`.obsidian/` 은 보지 않습니다.

```
<볼트>/            ← --root 에 넘기는 경로는 이 폴더(wiki/ 의 부모)입니다
└── wiki/
    ├── L1-working/     *.md
    ├── L2-episodic/    *.md
    ├── L3-semantic/    *.md
    ├── L4-procedural/  *.md
    └── moc/            *.md
```

---

## 2. 빠른 시작 (Claude Code 기준, 3분)

**① 볼트를 제대로 읽는지 확인** — 설치 없이 바로 실행됩니다.

```bash
npx -y obsidian-llmwiki-mcp --selftest --root "<볼트 경로>"
```

```
llmwiki-mcp 0.1.0 selftest
root: vault (sha256:6fa15f0f)
pages: 25
mocs: 3
buildGraph_ms: 7
startup_to_ready_ms: 11
```

`pages` 가 볼트의 페이지 수와 비슷하면 정상입니다. 경로는 로그·스크린샷에 새지 않도록 폴더 이름+해시로만 표시됩니다(전체 경로가 필요하면 `--show-root`). 첫 실행은 패키지를 내려받느라 몇 초 걸리고(실측 약 2.8초), 이후에는 1초 이내입니다.

**② 등록** — 모든 프로젝트에서 보이도록 사용자 범위로 등록합니다.

```bash
claude mcp add --scope user llmwiki -- npx -y obsidian-llmwiki-mcp --root '<볼트 경로>'
```

**③ 확인** — `claude mcp list` 에 `llmwiki` 가 connected 로 보이면 됩니다. 이제 볼트 밖의 아무 프로젝트에서 이렇게 물어보세요.

> 위키 기준으로 RAG 청킹과 임베딩에 대해 정리해줘. 신뢰도도 같이 적어줘.

---

## 3. 클라이언트별 등록

등록 스니펫은 서버가 직접 만들어 줍니다. **출력만 하고 설정 파일은 건드리지 않습니다**(설정 파일에 다른 서버의 비밀값이 있을 수 있기 때문).

```bash
npx -y obsidian-llmwiki-mcp print-config --client <클라이언트> --root "<볼트 경로>"
# <클라이언트> = claude-code | codex | agy | gemini | cursor | windsurf | claude-desktop | vscode
```

아래 블록은 그 명령의 실제 출력(0.1.0)에서 옮겼습니다 — 설명 주석 줄은 빼고, JSON 배열은 한 줄로 줄였으며, 모양이 같은 Cursor·Windsurf·Claude Desktop 은 하나로 묶었습니다. 내용(명령·인자·키)은 출력과 같습니다. `<VAULT>` 자리에 볼트 경로가 들어갑니다. JSON 설정형은 **기존 파일의 `mcpServers`(VS Code 는 `servers`)에 병합**하세요 — 파일을 통째로 덮어쓰면 다른 서버 설정이 사라집니다.

### Claude Code

```
claude mcp add --scope user llmwiki -- npx -y obsidian-llmwiki-mcp --root '<VAULT>'
```

### Codex CLI

```
codex mcp add llmwiki -- npx -y obsidian-llmwiki-mcp --root '<VAULT>'
```

첫 실행이 Codex 기본 기동 타임아웃(10초)을 넘으면 `~/.codex/config.toml` 에 타임아웃을 추가합니다. `codex mcp add -c …` 로는 지정할 수 없습니다(0.153.4 실측 — "invalid transport" 로 실패).

```toml
[mcp_servers.llmwiki]
command = "npx"
args = ["-y", "obsidian-llmwiki-mcp", "--root", "<VAULT>"]
startup_timeout_sec = 60
```

> **`codex exec`(비대화형)로 쓸 때**: 기본 `approval: never` 가 MCP 도구 호출을 막습니다. `--approve-for-me` 를 붙여야 도구가 실행됩니다.

### agy

```
agy mcp add llmwiki -- npx -y obsidian-llmwiki-mcp --root '<VAULT>'
```

agy 는 도구 선택이 다른 클라이언트보다 약해 `wiki_search`→전문 읽기로 새는 경향이 있습니다. [규칙 스니펫](#44-규칙-스니펫-라우팅이-약한-클라이언트용)을 함께 설치하길 권합니다.

### Gemini CLI — `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["-y", "obsidian-llmwiki-mcp", "--root", "<VAULT>"]
    }
  }
}
```

### Cursor · Windsurf · Claude Desktop

셋 다 같은 모양이고 볼트 경로를 `env` 로 넘깁니다. 파일 위치만 다릅니다.

| 클라이언트 | 설정 파일 |
|---|---|
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Claude Desktop | `claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["-y", "obsidian-llmwiki-mcp"],
      "env": { "LLMWIKI_ROOT": "<VAULT>" }
    }
  }
}
```

### VS Code (Copilot) — `.vscode/mcp.json`

최상위 키가 `mcpServers` 가 아니라 **`servers`** 이고 `"type": "stdio"` 가 들어갑니다.

```json
{
  "servers": {
    "llmwiki": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "obsidian-llmwiki-mcp", "--root", "<VAULT>"]
    }
  }
}
```

### Windows

어느 클라이언트든 `--windows` 를 붙여 생성하세요. 명령이 `cmd /c` 로 감싸지고, **볼트 경로는 명령줄이 아니라 항상 `LLMWIKI_ROOT` 환경변수로** 전달됩니다(cmd.exe 는 큰따옴표 안에서도 `%VAR%` 를 확장하기 때문).

```bash
npx -y obsidian-llmwiki-mcp print-config --client claude-code --root "<VAULT>" --windows
```

```
claude mcp add --scope user --env "LLMWIKI_ROOT=<VAULT>" llmwiki -- cmd /c npx -y obsidian-llmwiki-mcp
```

- 경로에 `%` 나 `!` 가 있으면 명령형 등록은 **거부**됩니다 — Cursor 같은 JSON 설정형을 쓰세요.
- PowerShell 에서 붙여 넣을 때는 값을 작은따옴표 `'…'` 로 감싸세요.
- Windows 등록 스니펫은 문법을 단위 테스트로 고정했지만, 실제 cmd.exe·PowerShell 에서의 등록은 아직 실측하지 못했습니다.

### 전역 설치로 쓰기(선택)

매번 `npx` 로 받지 않고 한 번 설치해 두면 기동이 빨라지고 오프라인에서도 동작합니다. Codex 타임아웃을 피하는 가장 간단한 방법이기도 합니다.

```bash
npm i -g obsidian-llmwiki-mcp
npx -y obsidian-llmwiki-mcp print-config --client claude-code --root "<VAULT>" --global
```

```
claude mcp add --scope user llmwiki -- llmwiki-mcp --root '<VAULT>'
```

전역 설치 뒤에는 명령 이름 `llmwiki-mcp` 를 씁니다(예: `llmwiki-mcp --selftest --root "<VAULT>"`).

---

## 4. 사용법

### 4.1 그냥 물어보면 됩니다

등록만 하면 에이전트가 알아서 도구를 고릅니다. "위키 기준으로", "위키에 뭐라고 돼 있어?" 처럼 위키를 가리키면 더 확실히 도구를 씁니다.

| 질문 예 | 에이전트가 하는 일 |
|---|---|
| "RAG 청킹과 임베딩에 대해 정리해줘" (사실 브리핑) | `wiki_expand(rerank=11)` → `wiki_pack` — 주장·신뢰도 팩으로 답합니다 |
| "HGX 섀시와 NVL72 랙 차이가 뭐야?" (비교) | 위와 같습니다 |
| "녹음 파일을 회의록으로 만드는 절차 알려줘" (절차) | `wiki_expand(max=8)` → `wiki_read_page` — 절차 페이지 본문을 읽습니다 |
| "concept-rag 페이지가 있어?" (단일 조회) | `wiki_expand(max≤6)` — seed 결과만으로 답합니다 |

### 4.2 도구 4개

| 도구 | 언제 | 입력(기본값·범위) | 돌려주는 것 |
|---|---|---|---|
| `wiki_expand` | **모든 위키 질문의 첫 호출** | `terms` 1~10개(각 ≤64자) · `max` 15(1~50) · `top_seed` 6(1~20) · `rerank` 0(0~50) | 후보 페이지 목록(`tier⇥refs⇥slug⇥type`, rerank 시 점수) + 마지막 줄 `suggested_next:` |
| `wiki_pack` | 사실 브리핑·비교 — expand 다음 | `slugs` 1~30개 | 페이지별 `## slug [type · conf · status]` + 주장(claim)·요약·관계 |
| `wiki_read_page` | 절차 질문, 또는 팩으로 결론이 안 날 때 | `slug` 1개(별칭은 한 번 따라감) | frontmatter 포함 본문 전체(최대 200KB) |
| `wiki_search` | expand 후보가 너무 적을 때만(fallback) | `terms` 1~10개 · `top` 8(1~50) | 일치 페이지 목록 |

`terms` 는 공백으로 구분한 문자열 하나로 보내도 됩니다. slug 에 `[[…]]`·`.md`·`wiki/…/` 가 붙어 있어도 알아서 떼어 냅니다.

### 4.3 서버가 요청하는 답변 규칙

- **신뢰도 병기** — 팩 헤더의 `conf`(0.6 / 0.85 / 0.95 …)를 답의 각 주장에 같이 적습니다.
- **stale 따라가기** — `status: stale` 페이지는 주근거로 쓰지 않고, `superseded_by` 가 가리키는 active 페이지를 `wiki_read_page` 로 확인합니다.
- **읽기 전용** — 위키에 저장·수정하려면 볼트 안의 `wiki-ops` 를 쓰세요.

이 규칙과 라우팅 표는 서버의 `instructions`, 각 도구 설명, `wiki_expand` 의 `suggested_next` 줄에 모두 들어 있어서 별도 설정 없이도 대부분의 클라이언트가 따릅니다. 실측(2026-09-10, 규칙 파일 없음): Claude Code 사실 3/3·절차 2/2, Codex 5/5 준수.

### 4.4 규칙 스니펫 (라우팅이 약한 클라이언트용)

도구를 엉뚱하게 고르는 클라이언트(실측상 agy)에는 저장소의 규칙 스니펫을 설치합니다. 원본은 [`templates/mcp-client-guide.md`](../../../templates/mcp-client-guide.md), 클라이언트별 파생본은 [`templates/clients/`](../../../templates/clients/) 에 있습니다.

| 클라이언트 | 파생본 | 설치 위치 |
|---|---|---|
| Claude Code | `claude-skill/SKILL.md` | `~/.claude/skills/llmwiki-query/SKILL.md` |
| agy | `claude-skill/SKILL.md`(같은 형식) | `~/.agents/skills/llmwiki-query/SKILL.md` — 2026-09-09 실측 |
| Codex CLI | `codex-AGENTS.md` | `~/.codex/AGENTS.md` 에 내용 추가 — P3 실측에 사용 |
| Gemini CLI | `gemini-GEMINI.md` | Gemini 의 `GEMINI.md` 규칙 파일(실사용 미검증) |
| Cursor | `cursor-llmwiki.mdc` | Cursor 규칙 파일(`.mdc`, 실사용 미검증) |

스니펫은 준수율을 높이는 보조 수단이고, 없어도 서버는 동작합니다.

---

## 5. 환경변수

| 변수 | 값 | 설명 |
|---|---|---|
| `LLMWIKI_ROOT` | 볼트 경로 | `--root` 대신 쓸 수 있습니다. 둘 다 있으면 `--root` 가 이깁니다 |
| `LLMWIKI_DEBUG` | `1` | 도구별 소요 시간을 stderr 에 남깁니다(`[llmwiki] wiki_pack 12ms`). **질의어·slug·본문·볼트 경로는 기록하지 않습니다** |
| `LLMWIKI_CACHE` | `0` / `1` | 프로세스 내 캐시를 강제로 끄거나 켭니다. 미지정이면 서버는 켜고 `--once`·`--selftest` 는 끕니다 |
| `LLMWIKI_STRUCTURED` | `1` | 텍스트와 함께 `structuredContent`(+ 도구별 `outputSchema`)도 보냅니다. 기본은 **텍스트만** — 구조화 필드를 프로그램으로 쓰는 클라이언트에서만 켜세요(`1` 외의 값은 무시) |

JSON 설정형이라면 `env` 블록에, Claude Code 라면 `claude mcp add … --env LLMWIKI_DEBUG=1 …` 처럼 넣습니다.

---

## 6. 명령어

```
llmwiki-mcp --root <vault>                       MCP stdio 서버 기동 (클라이언트가 실행)
llmwiki-mcp --selftest [--root <vault>] [--show-root]   페이지·MoC 수와 소요 시간 출력 후 종료
llmwiki-mcp print-config --client <c> --root <vault> [--windows] [--global] [--name <server>]
llmwiki-mcp --once <search|expand|pack> <args…> --root <vault>   서버 없이 1회 실행
llmwiki-mcp --version | --help
```

`npx` 로 쓸 때는 앞의 `llmwiki-mcp` 를 `npx -y obsidian-llmwiki-mcp` 로 바꾸면 됩니다. `--once` 는 에이전트 없이 검색 결과를 직접 보고 싶을 때 유용합니다.

```bash
npx -y obsidian-llmwiki-mcp --once expand 벡터 인덱스 --root "<VAULT>" --max 20 --rerank 11
npx -y obsidian-llmwiki-mcp --once pack concept-vector-index --root "<VAULT>"
```

---

## 7. 문제 해결

| 증상 | 원인·해결 |
|---|---|
| `vault root required: pass --root <path> or set LLMWIKI_ROOT` (종료 코드 2) | 볼트 경로를 넘기지 않았습니다. `--root` 또는 `LLMWIKI_ROOT` 를 지정하세요 |
| `vault root not found or not a directory: "…"` | 경로 오타이거나 폴더가 아닙니다 |
| `not an llmwiki vault (missing wiki/ directory): "…"` | `--root` 에는 **`wiki/` 의 부모 폴더**를 넘겨야 합니다(`wiki/` 자체가 아님) |
| `refusing vault whose wiki/ is a symbolic link: "…"` | 보안상 `wiki/` 가 심볼릭 링크인 볼트는 거부합니다. 실제 폴더 경로를 넘기세요 |
| Codex 에서 첫 실행 시 서버가 안 뜸 | `npx` 다운로드가 10초 타임아웃을 넘었습니다 — `config.toml` 에 `startup_timeout_sec = 60` 을 넣거나 전역 설치를 쓰세요 |
| `codex exec` 에서 도구가 호출되지 않음 | `--approve-for-me` 를 붙이세요(기본 승인 정책이 MCP 도구를 차단) |
| 방금 고친 내용이 안 보이는 것 같음 | 캐시는 파일 신원(mtime·ctime·inode·크기)이 바뀌면 다시 읽고, 2초 이내 수정 파일이 있으면 캐시를 쓰지 않습니다. 의심되면 `LLMWIKI_CACHE=0` 으로 비교하세요. **FAT/exFAT·일부 네트워크 드라이브**는 변경 시각이 부정확해 `LLMWIKI_CACHE=0` 을 권합니다 |
| 한글 slug 로 페이지를 못 찾음 | macOS 는 파일명을 NFD 로 저장해, 직접 타이핑한 NFC 한글과 다를 수 있습니다. slug 는 `wiki_expand` 결과에서 **복사해서** 쓰세요 |
| 첫 조회만 유독 느림 | OneDrive·iCloud 의 온디맨드 파일을 내려받는 중입니다. 두 번째부터는 빨라집니다 |
| 어떤 페이지가 결과에 안 나옴 | `wiki/` 안의 심볼릭 링크(파일·폴더)는 보안상 건너뜁니다. `wiki/` 밖(`raw/`, `index.md`)도 대상이 아닙니다 |
| Windows 에서 `%`·`!` 가 든 경로 등록이 거부됨 | 의도된 동작입니다 — JSON 설정형(`env`)으로 등록하세요 |
| 무엇이 느린지 보고 싶음 | `LLMWIKI_DEBUG=1` 로 도구별 소요 시간을 확인하세요 |

---

## 8. 업데이트와 제거

**업데이트** — 최신판을 확실히 받으려면 버전을 붙이세요.

```bash
npx -y obsidian-llmwiki-mcp@latest --selftest --root "<VAULT>"   # npx 로 쓰는 경우
npm i -g obsidian-llmwiki-mcp@latest                              # 전역 설치한 경우
```

등록을 특정 버전에 고정하고 싶다면 등록 명령의 패키지를 `obsidian-llmwiki-mcp@0.1.0` 처럼 적으면 됩니다.

**제거**

| 클라이언트 | 방법 |
|---|---|
| Claude Code | `claude mcp remove llmwiki` |
| Codex CLI | `codex mcp remove llmwiki` |
| agy | `agy mcp remove llmwiki` |
| Gemini CLI · Cursor · Windsurf · Claude Desktop · VS Code | 각 설정 파일에서 `llmwiki` 항목을 지우세요 |

전역 설치했다면 `npm rm -g obsidian-llmwiki-mcp` 도 실행하세요. 규칙 스니펫을 설치했다면 그 파일도 지웁니다. **볼트는 아무것도 바뀌지 않습니다** — 서버는 한 번도 쓰지 않았고, 볼트의 Python 하네스와도 독립적입니다.

---

## 9. 알아 둘 한계

- **stdio 전용** — HTTP·인증·다중 사용자 없음. 로컬 1인용 도구입니다.
- **응답 크기 상한** — 응답 하나는 200KB 이내로 잘립니다(잘리면 `…[truncated at 200 KB]` 표시).
- **볼트 규모 상한** — 마크다운 20,000개, 폴더 5,000개, 텍스트 총 512MiB. 넘으면 결과를 조용히 바꾸지 않고 오류를 냅니다.
- **대소문자 무시 파일시스템**(macOS·Windows 기본)에서는 대소문자가 다른 slug 가 열릴 수 있습니다.

더 자세한 계약·보안 경계는 [패키지 README](../README.md), 설계와 검증 기록은 [`develop_docs/v0.8.6/`](../../../develop_docs/v0.8.6/) 에 있습니다.

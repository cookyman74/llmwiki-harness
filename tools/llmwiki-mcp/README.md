# llmwiki-mcp

A read-only [MCP](https://modelcontextprotocol.io) server over an Obsidian **LLM wiki v2** vault. It exposes the vault's retrieval pipeline — lexical seeds → 1-hop graph expansion over `[[wikilinks]]` and `## 관계` relations → MoC members → optional BM25 rerank → compact *claim packs* — as four stdio tools, so an agent running anywhere (Claude Code in another repo, Codex CLI, Gemini CLI, agy, Cursor, Windsurf, Claude Desktop, VS Code) can answer from the wiki instead of re-reading it. Retrieval is deterministic and held byte-identical to the vault's Python reference scripts by parity tests; the server makes **no LLM calls**, opens **no network connections**, and contains **no filesystem write APIs**.

한국어: 옵시디언 LLM 위키 볼트를 읽기 전용으로 노출하는 MCP 서버. 볼트 밖 에이전트가 위키를 그대로 쓰게 한다.

---

## Requirements

| | |
|---|---|
| Node.js | **≥ 20** (uses regex lookbehind, `\p{…}`, `fs.promises`). Developed on v24. |
| Python | **not required at runtime.** The Python scripts in the source repo are the *reference implementation* used by the parity tests, not a dependency of this package. |
| Runtime deps | one: `@modelcontextprotocol/sdk` |
| Transport | stdio only |

---

## Vault layout it expects

```
<VAULT>/
└── wiki/
    ├── L1-working/     *.md
    ├── L2-episodic/    *.md
    ├── L3-semantic/    *.md
    ├── L4-procedural/  *.md
    └── moc/            *.md
```

Everything outside `<VAULT>/wiki/` is invisible to the server — `index.md`, `log.md`, `raw/`, and any `.obsidian/` config are out of scope (this matches the Python reference scripts). A page's **slug** is its file name without `.md`; when two files share a slug, the last one in sorted walk order wins.

What it reads inside a page:

| Element | Used for |
|---|---|
| Frontmatter `type` | row type column; falls back to the parent directory name (`L3-semantic`, …) in search/expand, and to `?` in pack headers |
| Frontmatter `aliases` | alias → slug resolution for links, lexical matching, and `wiki_read_page` redirect |
| Frontmatter `confidence`, `status` | pack header `[type · conf 0.85 · active]` |
| Frontmatter `superseded_by`, `last_confirmed` | returned by `wiki_read_page` so the agent can follow a stale page to its replacement |
| `- claim:: …` lines | the pack body (scanned across the whole document, code fences included) |
| `## 관계` lines like `- depends_on :: [[concept-chunking]] (sources: 2, confidence: 0.85)` | pack relations and graph edges (code fences *are* skipped here) |
| `[[wikilinks]]` | 1-hop graph expansion; `![[embeds]]` are excluded |

Body text is decoded as UTF-8 with a BOM stripped, invalid bytes replaced, and `\r\n`/`\r` normalized to `\n`.

---

## Install & register

Nothing to install ahead of time — `npx` fetches the package on first launch. Generate the exact snippet for your client:

```bash
npx llmwiki-mcp print-config --client <claude-code|codex|agy|gemini|cursor|windsurf|claude-desktop|vscode> \
  --root "<VAULT>"
```

`print-config` **only prints** — it never edits your client config files (they hold other servers' secrets). How the vault path is escaped depends on the client form:

| Client form | Clients | Escaping |
|---|---|---|
| Shell command (POSIX) | `claude-code`, `codex`, `agy` | Safe paths are emitted bare; anything with spaces, Korean characters, or shell metacharacters is wrapped in **single quotes** (`'` becomes `'\''`). Single quotes are the only fully inert quoting in `sh`/`bash` — double quotes would still let `$`, backticks and `!` expand. |
| JSON config | `gemini`, `cursor`, `windsurf`, `claude-desktop`, `vscode` | The path is a **JSON string value**, escaped by JSON rules. No shell is involved, so shell metacharacters are harmless. |
| Shell command (Windows) | `claude-code`, `codex`, `agy` with `--windows` | Double quotes with `"` escaped, and the path travels through `LLMWIKI_ROOT` rather than as an argument. `%` cannot be escaped at an interactive `cmd.exe` prompt, so paths containing `%` or `!` are **refused** — use a JSON-config client instead. |


Below is the real output for each client, with your vault path written as `<VAULT>`.

### Claude Code

```
# Claude Code — 사용자 범위(모든 프로젝트에서 보임)
claude mcp add --scope user llmwiki -- npx -y llmwiki-mcp --root <VAULT>
```

### Codex CLI

`npx` cold start can exceed Codex's default 10 s startup timeout. `startup_timeout_sec` cannot be set through `codex mcp add -c` (measured on 0.153.4: the `-c` override creates a table without `command` first, and registration fails with `invalid transport`), so register with the CLI and, if the cold start times out, add the timeout to `~/.codex/config.toml`. Warm start is well under a second once the package is in the npm cache.

```
# Codex CLI (0.153 실측)
codex mcp add llmwiki -- npx -y llmwiki-mcp --root <VAULT>
# npx 콜드스타트가 기본 기동 타임아웃(10s)을 넘으면 ~/.codex/config.toml 에 startup_timeout_sec 을 추가한다
# (`codex mcp add` 의 -c 플래그로는 지정할 수 없다 — command 없는 테이블이 먼저 만들어져 "invalid transport" 로 실패)
[mcp_servers.llmwiki]
command = "npx"
args = ["-y", "llmwiki-mcp", "--root", "<VAULT>"]
startup_timeout_sec = 60
```

### agy

```
# agy — 플래그는 name 앞, '-'로 시작하는 인자 앞에 '--'
agy mcp add llmwiki -- npx -y llmwiki-mcp --root <VAULT>
```

### Gemini CLI

Merge into `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": [
        "-y",
        "llmwiki-mcp",
        "--root",
        "<VAULT>"
      ]
    }
  }
}
```

### Cursor · Windsurf · Claude Desktop

Same block for all three; only the file differs — `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `claude_desktop_config.json`. These clients support an `env` block, which sidesteps path-quoting entirely.

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": [
        "-y",
        "llmwiki-mcp"
      ],
      "env": {
        "LLMWIKI_ROOT": "<VAULT>"
      }
    }
  }
}
```

### VS Code (Copilot)

`.vscode/mcp.json` uses `servers`, not `mcpServers`:

```json
{
  "servers": {
    "llmwiki": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "llmwiki-mcp",
        "--root",
        "<VAULT>"
      ]
    }
  }
}
```

> **Codex, non-interactive runs.** `codex exec` defaults to `approval: never`, which **blocks MCP tool calls** ("MCP tool call requires approval, but approval policy is never"). Pass `--approve-for-me` so the tools can run: `codex exec --approve-for-me "…"`. Interactive `codex` sessions are unaffected. Measured on 0.153.4 — `-c approval_policy="on-request"` does *not* override it.

### Windows (`--windows`)

| Client form | What `--windows` changes | Verification status |
|---|---|---|
| Shell command (`claude-code`, `codex`, `agy`) | `cmd /c` wrapper; path moves to `--env LLMWIKI_ROOT=…` / `-e …`; `%`/`!` paths refused | **Syntax fixed by unit tests only** — not yet executed in a real `cmd.exe`/PowerShell session |
| JSON config (`gemini`, `cursor`, `windsurf`, `claude-desktop`, `vscode`) | `cmd /c` wrapper inside `command`/`args`; path in the `env` block (same as POSIX) | **Syntax fixed by unit tests only** |

Add `--windows` to any of the above. Two things change: the command is wrapped in `cmd /c`, and **the vault path is never placed in the command line** — it always travels through `LLMWIKI_ROOT`, because `cmd.exe` expands `%VAR%` even inside double quotes and delayed-expansion sessions also expand `!VAR!`.

```
# Claude Code (Windows) — 경로는 env 로 전달
# (cmd.exe 는 큰따옴표 안에서도 %VAR% 를 확장하고 지연 확장 세션은 !VAR! 도 확장한다 — '%'·'!' 가 든 경로는 CLI 형 대신 JSON 설정형(env)을 쓰라. PowerShell 이면 값을 작은따옴표 '…' 로 감싸라)
claude mcp add --scope user --env LLMWIKI_ROOT=<VAULT> llmwiki -- cmd /c npx -y llmwiki-mcp
```

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "llmwiki-mcp"
      ],
      "env": {
        "LLMWIKI_ROOT": "<VAULT>"
      }
    }
  }
}
```

If the vault path contains `%` or `!`, `print-config --windows` **refuses** to emit a CLI-form registration (`claude-code`, `codex`, `agy`) and exits 2, because there is no way to escape those characters on an interactive `cmd.exe` command line:

```
vault root contains '%' or '!' which cmd.exe expands even inside quotes — use a JSON-config client form
(env block), e.g. --client cursor/vscode/gemini, or rename the path: "C:\\Users\\%USER%\\llmwiki"
```

Use a JSON-config client (`cursor`, `windsurf`, `claude-desktop`, `gemini`, `vscode`), which passes the path via `env`, or rename the directory.

### Global install (`--global`)

To avoid `npx` cold start altogether:

```bash
npm i -g llmwiki-mcp
npx llmwiki-mcp print-config --client claude-code --root "<VAULT>" --global
```

```
# Claude Code — 사용자 범위(모든 프로젝트에서 보임)
claude mcp add --scope user llmwiki -- llmwiki-mcp --root <VAULT>
```

JSON-config clients become `"command": "llmwiki-mcp", "args": []` with the path still in `env`.

### Verify

```bash
npx llmwiki-mcp --selftest --root "<VAULT>"
```

```
llmwiki-mcp 0.1.0 selftest
root: vault (sha256:6fa15f0f)
pages: 25
mocs: 3
buildGraph_ms: 122
startup_to_ready_ms: 197
```

The root is reported as basename + hash so logs and screenshots do not leak the full path; pass `--show-root` for the whole path.

---

## Tools

By default all four return **text only** in `content[0].text` — the same TSV/markdown text the Python scripts print, plus a `suggested_next:` routing line on `wiki_expand`. Set `LLMWIKI_STRUCTURED=1` to also declare an `outputSchema` per tool and return a matching JSON object in `structuredContent` (the two always go together — the MCP spec requires `structuredContent` once an `outputSchema` is declared). Why text is the default: Claude Code hands `structuredContent` to the model when it is present, and ours repeats the text alongside `rows`/`pages`, so the model received 2–4× the bytes (measured 2026-09-10: `wiki_pack` 9.7 KB of text became 20 KB). Turn it on only for programmatic clients that need the fields.

To opt in, add the variable to the server's environment — e.g. in a JSON client config `"env": { "LLMWIKI_ROOT": "<VAULT>", "LLMWIKI_STRUCTURED": "1" }`, or `claude mcp add … --env LLMWIKI_STRUCTURED=1 …`. Only the value `1` enables it. Note that in structured mode `content[0].text` stays the TSV/markdown text rather than a JSON serialisation of `structuredContent` (the MCP spec *recommends* the latter for backwards compatibility); this is deliberate, because the text is what text-only clients and the Python parity tests rely on. For large responses the text in structured mode can be shorter than in the default mode: the 200 KB budget covers the whole JSON response, and structured mode carries the text twice.

| Tool | When to call it | Inputs (default · range) | Returns |
|---|---|---|---|
| `wiki_expand` | **First call for every wiki question.** Lexical seeds → 1-hop neighbours → MoC members, optionally BM25-reranked. | `terms` string[] 1–10, each ≤64 chars · `max` 15 (1–50) · `top_seed` 6 (1–20) · `rerank` 0 (0–50) | text `tier⇥refs⇥slug⇥type` (or `tier⇥score⇥slug⇥type` when reranked) plus a trailing `suggested_next: …` line; JSON (with `LLMWIKI_STRUCTURED=1`) `{text, rows[], suggested_next, truncated}` |
| `wiki_pack` | After `wiki_expand(rerank=11)` for a factual briefing or comparison. Usually the last call. | `slugs` string[] 1–30, each ≤120 chars (`[[…]]`, `#anchor`, `\|alias`, `.md`, `wiki/…/` prefixes are tolerated) | text of `## slug  [type · conf X · status]` + `- claim` / `- (요약) …` / `- 관계) …`; JSON (with `LLMWIKI_STRUCTURED=1`) `{text, pages[], truncated}` |
| `wiki_read_page` | Procedure/how-to questions, or to settle one claim the pack could not. | `slug` string ≤120 chars; aliases resolved once | full page text incl. frontmatter (200 KB cap); JSON (with `LLMWIKI_STRUCTURED=1`) `{slug, resolved_from_alias, path, frontmatter{type, confidence, status, superseded_by?, last_confirmed?}, text, truncated}` |
| `wiki_search` | Fallback only, when `wiki_expand` returned too few candidates. | `terms` string[] 1–10 · `top` 8 (1–50) — a cap, not a fill | text `distinct/total⇥slug⇥type`, or `no matches for: <terms>`; JSON (with `LLMWIKI_STRUCTURED=1`) `{text, rows[], matched, truncated}` |

`terms` may also be sent as a single space-separated string; it is split at the handler. Integers may arrive as numeric strings. Anything else is rejected with a message naming the offending input.

### Routing

| Question type | Call sequence |
|---|---|
| Single lookup | `wiki_expand(terms, max≤6)` → answer from the seed rows |
| Factual briefing / comparison | `wiki_expand(terms, rerank=11)` → `wiki_pack(slugs)` → answer |
| Procedure / how-to | `wiki_expand(terms, max=8)` → `wiki_read_page(slug)` for the candidates |

`wiki_expand` computes this for you and reports it as `suggested_next` (`answer` when `max ≤ 6`, `wiki_pack` when `rerank > 0`, otherwise `wiki_read_page`) — as the last line of the text (and as a JSON field with `LLMWIKI_STRUCTURED=1`). The same table is in the server's `instructions` and in each tool's description, so clients that ignore `instructions` still get it.

### Answer conventions the server asks for

- **Cite confidence.** Every pack header carries `conf`; carry it into the answer.
- **Never answer from a `status: stale` page.** Follow its `superseded_by` with `wiki_read_page` and prefer the active page.
- **Prefer pack claims over full reads.** If the claims settle the question, do not call `wiki_read_page`.
- **Filing, ingest, and lint happen inside the vault's own tooling** — this server cannot write.

Example (`wiki_pack`):

```
## concept-vector-index  [concept · conf 0.85 · active]
- 벡터 인덱스는 임베딩을 근사 최근접 탐색 구조로 저장한다.
- Northwind 검색은 HNSW 벡터 인덱스를 기본으로 쓴다.
- 관계) depends_on :: [[concept-chunking]] (sources: 2, confidence: 0.85)
- 관계) used_by :: [[entity-northwind-search]]

## fact-latency-budget-old  [fact · conf 0.6 · stale]
- 검색 end-to-end 지연 예산은 1200ms다.
```

A slug that does not exist renders as `## <slug>` / `(없음)` rather than failing the whole call.

---

## CLI reference

```
llmwiki-mcp 0.1.0 — read-only MCP server over an llmwiki Obsidian vault

Usage:
  llmwiki-mcp --root <vault>                       start MCP stdio server (or set LLMWIKI_ROOT)
  llmwiki-mcp --selftest [--root <vault>] [--show-root]   print page/MoC counts and timings, then exit
  llmwiki-mcp print-config --client <c> --root <vault> [--windows] [--global] [--name <server>]
        <c> = claude-code | codex | gemini | agy | cursor | windsurf | claude-desktop | vscode
  llmwiki-mcp --once <search|expand|pack> <args…> --root <vault>   (same output as the Python scripts)
  llmwiki-mcp --version | --help
Env: LLMWIKI_ROOT (vault path), LLMWIKI_DEBUG=1 (per-tool timings on stderr),
     LLMWIKI_CACHE=0|1 (in-process cache; default on for the server, off for --once/--selftest),
     LLMWIKI_STRUCTURED=1 (also send structuredContent + outputSchema; default: text only)
```

- **`--root` / `LLMWIKI_ROOT`** — `--root` wins. The path is `realpath`-normalized; `<root>/wiki` must exist, must be a real directory (not a symlink), and must resolve to exactly `<root>/wiki`. Otherwise the process prints one line to stderr and exits 2, e.g. `vault root required: pass --root <path> or set LLMWIKI_ROOT`.
- **`--selftest [--show-root]`** — page count, MoC count, `buildGraph_ms`, `startup_to_ready_ms`. Use it to confirm installation and to pick a Codex `startup_timeout_sec`.
- **`print-config`** — see above. Prints only; exits 2 on an invalid client, an invalid server name (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`), an empty root, a root containing newline/NUL, or a Windows CLI-form root containing `%`/`!`.
- **`--once <search|expand|pack>`** — runs one retrieval through the *same functions* the MCP handlers use and writes the result to stdout. Its output is **byte-identical** to the vault's Python reference scripts (`search.py --files`, `scope-expand.py expand|pack`), which is exactly what the parity tests compare. The 200 KB truncation is deliberately *not* applied here, and `wiki_expand`'s extra `suggested_next:` line is an MCP-only addition, so `--once expand` stays comparable.

  ```bash
  llmwiki-mcp --once search 벡터 인덱스 --root <VAULT> --top 5
  llmwiki-mcp --once expand 벡터 인덱스 --root <VAULT> --max 20 --rerank 11
  llmwiki-mcp --once pack concept-vector-index fact-latency-budget-old --root <VAULT>
  ```

  ```
  seed	6.0	concept-vector-index	concept
  seed	4.3	procedure-deploy-index	procedure
  1hop	0.0	concept-chunking	concept
  moc	0.0	session-2026-09-01	session
  ```

  Integer options follow Python's `int()` strictness — `--top 1.5` is an error, not `1`.
- **`--version`, `--help`** — print and exit 0.
- **`LLMWIKI_DEBUG=1`** — per-tool timings on stderr (`[llmwiki] wiki_pack 12ms`). Query terms, slugs, page contents, and the vault path are never logged. stdout stays reserved for JSON-RPC.
- **`LLMWIKI_CACHE=0|1`** — force the in-process cache off or on. Unset, it is **on for the MCP server** (a long-lived process where it pays off) and **off for `--once` and `--selftest`** (one-shot processes never get a hit, so the cache would only add its `lstat` scan; `--selftest`'s `buildGraph_ms` keeps its original meaning). With `0`, every call walks, reads and rebuilds exactly as before the cache existed — use it to rule the cache out when results look wrong.

---

## Limits & guarantees

**Read-only.** `src/` uses only `readFile`, `readFileSync`, `readdir`, `stat`, `lstat`, `realpath`, `close`, `constants`, and `open` with read flags. CI enforces this with an allowlist over every `fs.*`/`fh.*` member reference *and* over the import statements themselves — namespace/default/dynamic `fs` imports, bracket access, aliased named imports, and any open with `O_WRONLY|O_RDWR|O_CREAT|O_APPEND|O_TRUNC` or a `"w"`/`"a"` mode all fail the build.

| Budget | Value |
|---|---|
| Response text | 200 KB **UTF-8 bytes** (truncated on a codepoint boundary, marker `…[truncated at 200 KB]`, `truncated: true`) |
| `wiki_pack` `structuredContent.pages` (only with `LLMWIKI_STRUCTURED=1`) | same 200 KB budget — pages are dropped from the end, then relations, then claims |
| Whole response envelope (text + JSON) | 200 KB; if it still does not fit after successive shrinking the call returns `isError` |
| Frontmatter scalar | 4 KiB each |
| `terms` | ≤10 items, ≤64 chars each |
| `slugs` | ≤30 items, ≤120 chars each |
| Raw input, before parsing | ≤4,096 chars per string, ≤256 items per array |
| Single file | ≤16 MiB |
| Vault | ≤20,000 markdown files, ≤5,000 directories, ≤32 directory levels, ≤512 MiB of text in total |
| `wiki_pack` input | ≤32 MiB read across the requested slugs |
| Concurrent tool calls | 4 (further calls queue in order) |

Exceeding a vault or pack limit raises a named error rather than silently returning a different result.

**Path containment.** `<root>/wiki` may not be a symlink and must resolve inside the root. Directory and file symlink entries encountered while walking `wiki/` are skipped. Every file's `realpath` is checked against `realpath(<root>/wiki)` using `path.relative` (not string prefixing, so `wiki2/` cannot slip through). Files are opened with `O_NOFOLLOW` where the platform provides it, so a final component swapped for a symlink after the check is not followed. `wiki_read_page` slugs may not contain `/`, `\`, `..`, control characters, or URL-encoded path characters.

---

## Limitations

- **No Unicode normalization.** macOS writes filenames in NFD; a query or slug typed in NFC will not match, and vice versa. This is deliberate — the Python reference implementation does not normalize either, and matching it byte-for-byte is the point. Copy slugs from `wiki_expand` output rather than typing them.
- **Case-insensitive filesystems** (default macOS, Windows) can resolve a differently-cased slug than the one you asked for; the graph index itself is case-sensitive.
- **Symlinks inside `wiki/` are skipped entirely**, files and directories alike. Pages reachable only through a symlink are invisible.
- **OneDrive / iCloud / cloud-on-demand files** can be very slow on first read while they are hydrated. Warm reads are unaffected.
- **stdio only.** No HTTP/SSE transport, no authentication, no multi-tenant use. It is a local single-user tool.
- **Every call still walks the vault and re-checks the boundary**; only reading and graph assembly are cached (see *Caching*). Measured on macOS/Apple Silicon with Node 24: a cold call is ≈50 ms for a 309-page vault and ≈190 ms for 1,000 pages; a warm call is ≈9 ms and ≈24 ms. Process start-up adds ~110 ms, paid once for a stdio server.
- **The cache key is `(path, dev, ino, mode, size, mtime_ns, ctime_ns)` per file, plus the vault's realpath.** `ctime` is what makes restored timestamps safe: `cp -p`, `rsync --times` and `touch -t` put `mtime` back, but the kernel still bumps `ctime`, so the cache misses and re-reads. A file replaced by a different file or a symlink changes `ino`/`mode` and also misses. Snapshots containing a file modified in the last 2 seconds are never stored, because a same-size edit inside the filesystem's timestamp resolution would be indistinguishable.
- **Snapshots with a file modified in the last 2 seconds are treated as unstable**: nothing is stored *and* nothing cached is reused — every file is re-read on that call.
- **Memory caps are logical, not RSS**: up to 4 vaults are kept (LRU), each holding at most 256 MiB of page text, 512 MiB across all vaults, plus 128 MiB of derived strings. These count string payload only — object overhead comes on top.
- **Where the `ctime` defence does not hold**: Node reports the status-change time as `ctime` on POSIX filesystems and on NTFS (creation time is the separate `birthtime`), but **FAT/exFAT and some network filesystems** have no reliable change time. On such a volume, a same-size edit whose `mtime` is restored by an external tool can be served stale until the file changes again. Run with `LLMWIKI_CACHE=0` there.
- **Rerank scores are floating point.** `Math.log` in V8 and `math.log` in CPython can differ by 1 ULP, so a printed `.1f` score may differ by 0.1 at an exact rounding boundary; parity tests allow ±0.05 on the score column and require exact row order.
- **`index.md` and `log.md` are out of scope** — they live outside `wiki/`.

---

## Uninstall / rollback

| Client | Command |
|---|---|
| Claude Code | `claude mcp remove llmwiki` |
| Codex CLI | `codex mcp remove llmwiki` |
| agy | `agy mcp remove llmwiki` |
| Gemini CLI | delete the `llmwiki` entry from `~/.gemini/settings.json` |
| Cursor | delete the `llmwiki` entry from `~/.cursor/mcp.json` |
| Windsurf | delete the `llmwiki` entry from `~/.codeium/windsurf/mcp_config.json` |
| Claude Desktop | delete the `llmwiki` entry from `claude_desktop_config.json` |
| VS Code | delete the `llmwiki` entry from `.vscode/mcp.json` |

If you installed globally, also `npm rm -g llmwiki-mcp`. Removing the server changes nothing in the vault — it never wrote anything, and the vault's own Python tooling is independent of it.

---

## Source & license

Source, design documents, and parity tests: **https://github.com/cookyman74/llmwiki-harness** (`tools/llmwiki-mcp/`; design notes under `develop_docs/v0.8.6/`).

MIT © cookyman74

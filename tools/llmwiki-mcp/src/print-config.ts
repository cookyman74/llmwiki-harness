/**
 * print-config.ts — 클라이언트별 등록 스니펫 생성 (DESIGN §3.5, §8; P2-25). **출력만 한다 — 파일에 쓰지 않는다**
 * (클라이언트 설정 파일은 타 서버의 비밀키를 담고 있어 자동 편집이 위험).
 *
 * 문법은 2026-09-09 로컬 실측: `agy mcp add [flags] <name> -- <cmd…>`(플래그는 name 앞, `-e KEY=value`),
 * `codex mcp add <NAME> [-c key=value] [--env KEY=VALUE] -- <COMMAND…>` 0.153.4, `claude mcp add [--env KEY=VALUE] <name> -- <cmd…>`,
 * `~/.gemini/settings.json`·`~/.cursor/mcp.json` 의 `mcpServers`, VS Code `.vscode/mcp.json` 은 최상위 키 `servers`.
 *
 * 보안(P2 외부리뷰 반영):
 * - 서버 이름은 `^[A-Za-z][A-Za-z0-9_-]{0,63}$` 만 허용 — 셸 명령·TOML 테이블 경로에 삽입되므로(주입 방지).
 * - **Windows(`--windows`)에서는 볼트 경로를 명령 인자로 절대 넣지 않는다** — `cmd /c` 는 `&`·`|`·`%VAR%`·`!` 를 해석한다.
 *   JSON 설정형은 `env.LLMWIKI_ROOT`, CLI 형은 각 클라이언트의 `--env`/`-e` 플래그로 전달한다.
 * - POSIX CLI 형은 큰따옴표 인용 + `"`·`\`·`$`·백틱 이스케이프. 개행·NUL 이 든 경로는 거부.
 */

export const CLIENTS = ["claude-code", "codex", "gemini", "agy", "cursor", "windsurf", "claude-desktop", "vscode"] as const;
export type ClientName = (typeof CLIENTS)[number];

export interface PrintConfigOptions {
  client: ClientName;
  root: string;
  windows?: boolean; // Windows 클라이언트: cmd /c 래핑 + 경로는 env 로만
  global?: boolean; // npm i -g 전제: npx -y 대신 llmwiki-mcp 직접 실행
  name?: string; // 서버 이름(기본 llmwiki)
}

export class PrintConfigError extends Error {}

export const SERVER_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function checkName(name: string): string {
  if (!SERVER_NAME_RE.test(name)) throw new PrintConfigError(`invalid server name (allowed: ${SERVER_NAME_RE.source}): ${JSON.stringify(name)}`);
  return name;
}

function checkRoot(root: string): string {
  if (root.trim() === "") throw new PrintConfigError("vault root is empty");
  if (/[\n\r\0]/.test(root)) throw new PrintConfigError("vault root must not contain newline or NUL characters");
  return root;
}

/** npm 패키지 이름 — package.json `name` 과 같아야 한다(테스트가 고정). 원안 `llmwiki-mcp` 는 npm 유사도 정책(기존
 *  `llm-wiki-mcp`)으로 거부되어 2026-09-11 변경. */
export const PKG_NAME = "obsidian-llmwiki-mcp";
/** 설치되는 실행 명령(package.json `bin`). 패키지 이름과 달라도 bin 이 하나라 `npx -y <PKG_NAME>` 이 이 명령을 실행한다. */
export const BIN_NAME = "llmwiki-mcp";

/** 실행 명령 토큰. global 이면 [BIN_NAME], 아니면 [npx, -y, PKG_NAME]. Windows 는 cmd /c 래핑. */
function commandTokens(o: PrintConfigOptions): { command: string; args: string[] } {
  const base = o.global ? { command: BIN_NAME, args: [] as string[] } : { command: "npx", args: ["-y", PKG_NAME] };
  if (o.windows) return { command: "cmd", args: ["/c", base.command, ...base.args] };
  return base;
}

/** POSIX 셸 인용: 안전 문자만이면 그대로, 아니면 **작은따옴표**로 감싼다(`'` 는 `'\''` 로 분해).
 *  큰따옴표는 `$`·백틱·`!`(history expansion) 를 셸이 해석할 여지를 남긴다 — 작은따옴표가 유일하게 완전한 인용(codex 3차 MINOR-7). */
export function shq(s: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Windows cmd.exe 인용(codex 2차 #6): 큰따옴표로 감싸고 `"`→`\"`. **`%` 는 이스케이프할 수 없다** — 대화형 cmd.exe 는 큰따옴표
 *  안에서도 `%VAR%` 를 확장하고 `%%` 는 배치 파일에서만 이스케이프다(P2 3차 테스트 검토 지적). 따라서 `%`·`!` 가 든 경로는
 *  CLI 형 등록을 **거부**하고 JSON 설정형(env 블록)을 안내한다(`printConfig` 참조). */
export function cmdq(s: string): string {
  return /^[A-Za-z0-9_.:\\/=+-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}
const WIN_NOTE =
  "# (cmd.exe 는 큰따옴표 안에서도 %VAR% 를 확장하고 지연 확장 세션은 !VAR! 도 확장한다 — '%'·'!' 가 든 경로는 CLI 형 대신 JSON 설정형(env)을 쓰라. PowerShell 이면 값을 작은따옴표 '…' 로 감싸라)\n";
const WIN_CLI_UNSAFE = /[%!]/;

function jsonBlock(topKey: string, name: string, entry: Record<string, unknown>): string {
  return JSON.stringify({ [topKey]: { [name]: entry } }, null, 2);
}

export function printConfig(o: PrintConfigOptions): string {
  const name = checkName(o.name ?? "llmwiki");
  const root = checkRoot(o.root);
  const { command, args } = commandTokens(o);
  // 경로 전달 방식: Windows 는 env 전용, POSIX CLI 형은 인자, JSON 설정형(env 지원 클라이언트)은 env
  const argsWithRoot = o.windows ? args : [...args, "--root", root];
  const envKV = `LLMWIKI_ROOT=${root}`;
  const q = o.windows ? cmdq : shq; // CLI 형 인용: Windows 는 cmd.exe 규칙
  const cliForm = o.client === "claude-code" || o.client === "codex" || o.client === "agy";
  if (o.windows && cliForm && WIN_CLI_UNSAFE.test(root)) {
    throw new PrintConfigError(
      `vault root contains '%' or '!' which cmd.exe expands even inside quotes — use a JSON-config client form (env block), e.g. --client cursor/vscode/gemini, or rename the path: ${JSON.stringify(root)}`,
    );
  }
  const cmdShell = [command, ...argsWithRoot].map(q).join(" ");
  switch (o.client) {
    case "claude-code":
      return o.windows
        ? `# Claude Code (Windows) — 경로는 env 로 전달\n${WIN_NOTE}claude mcp add --scope user --env ${cmdq(envKV)} ${name} -- ${cmdShell}\n`
        : `# Claude Code — 사용자 범위(모든 프로젝트에서 보임)\nclaude mcp add --scope user ${name} -- ${cmdShell}\n`;
    case "codex": {
      // `codex mcp add <name> -c mcp_servers.<name>.startup_timeout_sec=60 -- <cmd>` 는 **실패한다**
      // (codex 0.153.4 실측 2026-09-09: `-c` 오버라이드가 command 없는 테이블을 먼저 만들어 "invalid transport").
      // → CLI 는 플래그 없이 등록하고, 타임아웃이 필요하면 config.toml 을 편집한다.
      const envFlag = o.windows ? ` --env ${cmdq(envKV)}` : "";
      const tomlArgs = argsWithRoot.map((a) => JSON.stringify(a)).join(", ");
      const tomlEnv = o.windows ? `\n[mcp_servers.${name}.env]\nLLMWIKI_ROOT = ${JSON.stringify(root)}\n` : "";
      return (
        `# Codex CLI (0.153 실측)\n` +
        (o.windows ? WIN_NOTE : "") +
        `codex mcp add ${name}${envFlag} -- ${cmdShell}\n` +
        `# npx 콜드스타트가 기본 기동 타임아웃(10s)을 넘으면 ~/.codex/config.toml 에 startup_timeout_sec 을 추가한다\n` +
        `# (\`codex mcp add\` 의 -c 플래그로는 지정할 수 없다 — command 없는 테이블이 먼저 만들어져 "invalid transport" 로 실패)\n` +
        `[mcp_servers.${name}]\ncommand = ${JSON.stringify(command)}\nargs = [${tomlArgs}]\nstartup_timeout_sec = 60\n` +
        tomlEnv
      );
    }
    case "agy":
      return o.windows
        ? `# agy (Windows) — 플래그는 name 앞, 경로는 env 로 전달\n${WIN_NOTE}agy mcp add -e ${cmdq(envKV)} ${name} -- ${cmdShell}\n`
        : `# agy — 플래그는 name 앞, '-'로 시작하는 인자 앞에 '--'\nagy mcp add ${name} -- ${cmdShell}\n`;
    case "gemini":
      return (
        `# Gemini CLI — ~/.gemini/settings.json 의 mcpServers 에 병합\n` +
        jsonBlock("mcpServers", name, o.windows ? { command, args, env: { LLMWIKI_ROOT: root } } : { command, args: argsWithRoot }) +
        "\n"
      );
    case "cursor":
    case "windsurf":
    case "claude-desktop": {
      const file = o.client === "cursor" ? "~/.cursor/mcp.json" : o.client === "windsurf" ? "~/.codeium/windsurf/mcp_config.json" : "claude_desktop_config.json";
      // env 블록 지원 클라이언트 → LLMWIKI_ROOT 로 경로 인용 문제 회피(POSIX·Windows 공통)
      return `# ${o.client} — ${file} 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` + jsonBlock("mcpServers", name, { command, args, env: { LLMWIKI_ROOT: root } }) + "\n";
    }
    case "vscode":
      return (
        `# VS Code (Copilot) — .vscode/mcp.json 은 최상위 키가 "servers"\n` +
        jsonBlock("servers", name, o.windows ? { type: "stdio", command, args, env: { LLMWIKI_ROOT: root } } : { type: "stdio", command, args: argsWithRoot }) +
        "\n"
      );
  }
}

export function isClientName(s: string): s is ClientName {
  return (CLIENTS as readonly string[]).includes(s);
}

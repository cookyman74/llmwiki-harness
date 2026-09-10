/**
 * P2-26 print-config 스냅샷 — 8 클라이언트 × {기본, --windows, --global} = 24종 (DESIGN §3.5, §8).
 * 기대 문자열은 print-config.ts 를 읽어 **손으로 도출해 리터럴로** 적었다 — 출력 문법이 조금이라도 바뀌면 여기서 드러난다.
 * 경로는 공백+한글(OneDrive 흔한 사례)을 넣어 셸 인용·JSON 직렬화를 함께 검사한다.
 *
 * P2 외부 보안리뷰 반영(2026-09-09):
 * - `--windows` 는 볼트 경로를 **명령 인자로 절대 넣지 않는다**(`cmd /c` 가 `&`·`|`·`%VAR%`·`!` 를 해석). JSON 설정형은
 *   env.LLMWIKI_ROOT, CLI 형은 `--env`(claude-code·codex) / `-e`(agy), codex TOML 은 `[mcp_servers.<name>.env]` 테이블.
 * - P3 실측(codex 0.153.4): `codex mcp add <name> -c mcp_servers.<name>.startup_timeout_sec=60 -- <cmd>` 는 **실패한다**
 *   ("invalid transport" — `-c` 가 command 없는 테이블을 먼저 만든다). 그래서 CLI 는 플래그 없이 등록하고 타임아웃은 config.toml 로 안내한다.
 * - 3차 리뷰(codex MINOR-7): **POSIX CLI 형은 작은따옴표**로 인용한다(`'` 는 `'\''` 로 분해). 큰따옴표는 `$`·백틱·`!`(history
 *   expansion) 를 셸이 해석할 여지를 남기기 때문. 따라서 POSIX 스냅샷의 경로는 `'/Users/x y/OneDrive-개인/llmwiki.obsidian'` 이다.
 * - 2차 리뷰(codex #6)·3차 정정: Windows CLI 형은 cmdq()(큰따옴표, `"`→`\"`; `%` 는 이스케이프 불가)로 인용하고 명령 앞에
 *   WIN_NOTE 주석 1줄을 낸다. `%`·`!` 가 든 root 는 CLI 형에서 PrintConfigError. 안전 집합에 `/` 가 있어 `cmd /c …` 로 찍힌다.
 * - gemini 주석에서 `gemini mcp add …` 대안 명령이 빠졌다(인자에 경로가 들어가는 형태를 안내하지 않는다).
 */
import { describe, expect, it } from "vitest";
import { CLIENTS, isClientName, printConfig, type ClientName } from "../../src/print-config.js";

const ROOT = "/Users/x y/OneDrive-개인/llmwiki.obsidian";
const RQ = `'${ROOT}'`; // POSIX 셸 인용형 — 작은따옴표(shq; 3차 리뷰 MINOR-7). 경로에 `'` 가 없어 분해 이스케이프는 없다
const RJ = `"/Users/x y/OneDrive-개인/llmwiki.obsidian"`; // JSON 직렬화(한글 이스케이프 없음)
const ENVQ = `"LLMWIKI_ROOT=${ROOT}"`; // Windows CLI 형: cmdq(`LLMWIKI_ROOT=<root>`) — 공백·한글·`/` 가 있어 인용, `%`·`"` 없음
const WIN_NOTE = "# (cmd.exe 는 큰따옴표 안에서도 %VAR% 를 확장하고 지연 확장 세션은 !VAR! 도 확장한다 — '%'·'!' 가 든 경로는 CLI 형 대신 JSON 설정형(env)을 쓰라. PowerShell 이면 값을 작은따옴표 '…' 로 감싸라)\n";
const CMDW = "cmd /c npx -y obsidian-llmwiki-mcp";

type Variant = "default" | "windows" | "global";
const VARIANTS: Variant[] = ["default", "windows", "global"];
const opts = (client: ClientName, v: Variant) => ({ client, root: ROOT, windows: v === "windows", global: v === "global" });

// prettier-ignore
const EXPECTED: Record<ClientName, Record<Variant, string>> = {
  "claude-code": {
    default: `# Claude Code — 사용자 범위(모든 프로젝트에서 보임)\nclaude mcp add --scope user llmwiki -- npx -y obsidian-llmwiki-mcp --root ${RQ}\n`,
    windows: `# Claude Code (Windows) — 경로는 env 로 전달\n${WIN_NOTE}claude mcp add --scope user --env ${ENVQ} llmwiki -- ${CMDW}\n`,
    global: `# Claude Code — 사용자 범위(모든 프로젝트에서 보임)\nclaude mcp add --scope user llmwiki -- llmwiki-mcp --root ${RQ}\n`,
  },
  codex: {
    default: `# Codex CLI (0.153 실측)\ncodex mcp add llmwiki -- npx -y obsidian-llmwiki-mcp --root '${ROOT}'\n# npx 콜드스타트가 기본 기동 타임아웃(10s)을 넘으면 ~/.codex/config.toml 에 startup_timeout_sec 을 추가한다\n# (\`codex mcp add\` 의 -c 플래그로는 지정할 수 없다 — command 없는 테이블이 먼저 만들어져 "invalid transport" 로 실패)\n[mcp_servers.llmwiki]\ncommand = "npx"\nargs = ["-y", "obsidian-llmwiki-mcp", "--root", "${ROOT}"]\nstartup_timeout_sec = 60\n`,
    windows: `# Codex CLI (0.153 실측)\n# (cmd.exe 는 큰따옴표 안에서도 %VAR% 를 확장하고 지연 확장 세션은 !VAR! 도 확장한다 — '%'·'!' 가 든 경로는 CLI 형 대신 JSON 설정형(env)을 쓰라. PowerShell 이면 값을 작은따옴표 '…' 로 감싸라)\ncodex mcp add llmwiki --env "LLMWIKI_ROOT=${ROOT}" -- cmd /c npx -y obsidian-llmwiki-mcp\n# npx 콜드스타트가 기본 기동 타임아웃(10s)을 넘으면 ~/.codex/config.toml 에 startup_timeout_sec 을 추가한다\n# (\`codex mcp add\` 의 -c 플래그로는 지정할 수 없다 — command 없는 테이블이 먼저 만들어져 "invalid transport" 로 실패)\n[mcp_servers.llmwiki]\ncommand = "cmd"\nargs = ["/c", "npx", "-y", "obsidian-llmwiki-mcp"]\nstartup_timeout_sec = 60\n\n[mcp_servers.llmwiki.env]\nLLMWIKI_ROOT = "${ROOT}"\n`,
    global: `# Codex CLI (0.153 실측)\ncodex mcp add llmwiki -- llmwiki-mcp --root '${ROOT}'\n# npx 콜드스타트가 기본 기동 타임아웃(10s)을 넘으면 ~/.codex/config.toml 에 startup_timeout_sec 을 추가한다\n# (\`codex mcp add\` 의 -c 플래그로는 지정할 수 없다 — command 없는 테이블이 먼저 만들어져 "invalid transport" 로 실패)\n[mcp_servers.llmwiki]\ncommand = "llmwiki-mcp"\nargs = ["--root", "${ROOT}"]\nstartup_timeout_sec = 60\n`,
  },
  agy: {
    default: `# agy — 플래그는 name 앞, '-'로 시작하는 인자 앞에 '--'\nagy mcp add llmwiki -- npx -y obsidian-llmwiki-mcp --root ${RQ}\n`,
    windows: `# agy (Windows) — 플래그는 name 앞, 경로는 env 로 전달\n${WIN_NOTE}agy mcp add -e ${ENVQ} llmwiki -- ${CMDW}\n`,
    global: `# agy — 플래그는 name 앞, '-'로 시작하는 인자 앞에 '--'\nagy mcp add llmwiki -- llmwiki-mcp --root ${RQ}\n`,
  },
  gemini: {
    default:
      `# Gemini CLI — ~/.gemini/settings.json 의 mcpServers 에 병합\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "obsidian-llmwiki-mcp",\n        "--root",\n        ${RJ}\n      ]\n    }\n  }\n}\n`,
    windows:
      `# Gemini CLI — ~/.gemini/settings.json 의 mcpServers 에 병합\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "cmd",\n      "args": [\n        "/c",\n        "npx",\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    global:
      `# Gemini CLI — ~/.gemini/settings.json 의 mcpServers 에 병합\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "llmwiki-mcp",\n      "args": [\n        "--root",\n        ${RJ}\n      ]\n    }\n  }\n}\n`,
  },
  cursor: {
    default:
      `# cursor — ~/.cursor/mcp.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    windows:
      `# cursor — ~/.cursor/mcp.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "cmd",\n      "args": [\n        "/c",\n        "npx",\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    global:
      `# cursor — ~/.cursor/mcp.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "llmwiki-mcp",\n      "args": [],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
  },
  windsurf: {
    default:
      `# windsurf — ~/.codeium/windsurf/mcp_config.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    windows:
      `# windsurf — ~/.codeium/windsurf/mcp_config.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "cmd",\n      "args": [\n        "/c",\n        "npx",\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    global:
      `# windsurf — ~/.codeium/windsurf/mcp_config.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "llmwiki-mcp",\n      "args": [],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
  },
  "claude-desktop": {
    default:
      `# claude-desktop — claude_desktop_config.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    windows:
      `# claude-desktop — claude_desktop_config.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "cmd",\n      "args": [\n        "/c",\n        "npx",\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    global:
      `# claude-desktop — claude_desktop_config.json 의 mcpServers 에 병합 (env 블록으로 볼트 경로 전달)\n` +
      `{\n  "mcpServers": {\n    "llmwiki": {\n      "command": "llmwiki-mcp",\n      "args": [],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
  },
  vscode: {
    default:
      `# VS Code (Copilot) — .vscode/mcp.json 은 최상위 키가 "servers"\n` +
      `{\n  "servers": {\n    "llmwiki": {\n      "type": "stdio",\n      "command": "npx",\n      "args": [\n        "-y",\n        "obsidian-llmwiki-mcp",\n        "--root",\n        ${RJ}\n      ]\n    }\n  }\n}\n`,
    windows:
      `# VS Code (Copilot) — .vscode/mcp.json 은 최상위 키가 "servers"\n` +
      `{\n  "servers": {\n    "llmwiki": {\n      "type": "stdio",\n      "command": "cmd",\n      "args": [\n        "/c",\n        "npx",\n        "-y",\n        "obsidian-llmwiki-mcp"\n      ],\n      "env": {\n        "LLMWIKI_ROOT": ${RJ}\n      }\n    }\n  }\n}\n`,
    global:
      `# VS Code (Copilot) — .vscode/mcp.json 은 최상위 키가 "servers"\n` +
      `{\n  "servers": {\n    "llmwiki": {\n      "type": "stdio",\n      "command": "llmwiki-mcp",\n      "args": [\n        "--root",\n        ${RJ}\n      ]\n    }\n  }\n}\n`,
  },
};

const JSON_CLIENTS: ClientName[] = ["gemini", "cursor", "windsurf", "claude-desktop", "vscode"];
const SHELL_CLIENTS: ClientName[] = ["claude-code", "codex", "agy"];

/** 선두 `#` 주석 줄을 떼고 JSON 파싱. */
function parseJsonBody(out: string): Record<string, Record<string, Record<string, unknown>>> {
  const body = out
    .split("\n")
    .filter((ln) => !ln.startsWith("#"))
    .join("\n");
  return JSON.parse(body) as Record<string, Record<string, Record<string, unknown>>>;
}

/** 주석(#) 줄을 제외한 본문 줄. */
function bodyLines(out: string): string[] {
  return out.split("\n").filter((ln) => !ln.startsWith("#"));
}

describe("P2-26 print-config snapshots", () => {
  it("P2-26 클라이언트 목록은 §3.5 의 8종", () => {
    expect([...CLIENTS]).toEqual(["claude-code", "codex", "gemini", "agy", "cursor", "windsurf", "claude-desktop", "vscode"]);
    expect(isClientName("bogus")).toBe(false);
    expect(isClientName("vscode")).toBe(true);
  });

  for (const client of CLIENTS) {
    for (const v of VARIANTS) {
      it(`P2-26 ${client} [${v}] 스냅샷 일치`, () => {
        expect(printConfig(opts(client, v))).toBe(EXPECTED[client][v]);
      });
    }
  }

  it("P2-26 --windows 는 cmd /c npx -y obsidian-llmwiki-mcp 래핑", () => {
    for (const client of JSON_CLIENTS) {
      const j = parseJsonBody(printConfig(opts(client, "windows")));
      const entry = j[client === "vscode" ? "servers" : "mcpServers"].llmwiki;
      expect(entry.command).toBe("cmd");
      expect(entry.args as string[]).toEqual(["/c", "npx", "-y", "obsidian-llmwiki-mcp"]);
    }
    for (const client of SHELL_CLIENTS) {
      const out = printConfig(opts(client, "windows"));
      expect(out, client).toContain(` -- ${CMDW}\n`);
      // 토큰 단위(cmdq 인용 제거) = cmd /c npx -y obsidian-llmwiki-mcp — 경로 토큰은 없다
      const [cmdLine] = bodyLines(out).filter((ln) => ln.includes(" -- cmd "));
      expect(cmdLine, client).toBeDefined();
      const tokens = cmdLine.split(" -- ")[1].split(" ").map((t) => t.replace(/^"|"$/g, ""));
      expect(tokens, client).toEqual(["cmd", "/c", "npx", "-y", "obsidian-llmwiki-mcp"]);
      // WIN_NOTE 주석은 명령 줄 바로 앞
      const lines = out.split("\n");
      expect(lines[lines.indexOf(cmdLine) - 1], client).toBe(WIN_NOTE.trimEnd());
      expect(lines[lines.indexOf(cmdLine) - 1], client).toMatch(/^#.*%VAR%.*!VAR!.*JSON 설정형.*PowerShell/);
    }
  });

  it("P2-26 --windows 는 볼트 경로를 인자로 넣지 않는다 — --root 없음, LLMWIKI_ROOT 는 env/--env/-e 로", () => {
    for (const client of CLIENTS) {
      const out = printConfig(opts(client, "windows"));
      expect(out, client).not.toContain("--root");
      expect(out, client).toContain("LLMWIKI_ROOT");
    }
    // JSON 설정형: env.LLMWIKI_ROOT, args 에 경로 없음
    for (const client of JSON_CLIENTS) {
      const e = parseJsonBody(printConfig(opts(client, "windows")))[client === "vscode" ? "servers" : "mcpServers"].llmwiki;
      expect((e.env as Record<string, string>).LLMWIKI_ROOT, client).toBe(ROOT);
      expect(e.args as string[], client).not.toContain(ROOT);
    }
    // CLI 형: 클라이언트별 env 플래그 + 인용된 KEY=value
    expect(printConfig(opts("claude-code", "windows"))).toContain(`--env ${ENVQ} llmwiki -- `);
    expect(printConfig(opts("codex", "windows"))).toContain(`--env ${ENVQ} -- `);
    expect(printConfig(opts("agy", "windows"))).toContain(`agy mcp add -e ${ENVQ} llmwiki -- `);
    // codex TOML: args 에 경로 없음 + env 테이블
    const codex = printConfig(opts("codex", "windows"));
    expect(codex).toContain(`args = ["/c", "npx", "-y", "obsidian-llmwiki-mcp"]\n`);
    expect(codex).toContain(`[mcp_servers.llmwiki.env]\nLLMWIKI_ROOT = ${RJ}\n`);
  });

  it("P2-26 --global 은 npx 없이 llmwiki-mcp 직접 실행", () => {
    for (const client of CLIENTS) {
      // 주석(#) 줄은 제외 — codex 주석이 "npx 콜드스타트" 를 언급한다
      const body = bodyLines(printConfig(opts(client, "global"))).join("\n");
      expect(body, client).not.toContain("npx");
      expect(body, client).toContain("llmwiki-mcp");
    }
    for (const client of JSON_CLIENTS) {
      const j = parseJsonBody(printConfig(opts(client, "global")));
      expect(j[client === "vscode" ? "servers" : "mcpServers"].llmwiki.command).toBe("llmwiki-mcp");
    }
  });

  it("P2-26 셸 명령은 공백+한글 경로를 작은따옴표로 인용, 인용 없는 토큰은 그대로", () => {
    for (const client of SHELL_CLIENTS) {
      for (const v of ["default", "global"] as Variant[]) {
        const out = printConfig(opts(client, v));
        expect(out).toContain(`--root ${RQ}`);
        expect(out).not.toContain(`--root ${ROOT}\n`); // 인용 누락 금지
      }
      // Windows 는 env 플래그 값으로 — 역시 인용
      const w = printConfig(opts(client, "windows"));
      expect(w).toContain(ENVQ);
      expect(w).not.toContain(`LLMWIKI_ROOT=${ROOT} `);
    }
    // 작은따옴표 안에서는 `"` `$` `\` `` ` `` 가 모두 리터럴 — 이스케이프 없이 그대로 실린다(3차 리뷰 MINOR-7)
    const weird = printConfig({ client: "claude-code", root: 'a b"c$d`e\\f' });
    expect(weird).toContain(`--root 'a b"c$d\`e\\f'`);
    // 경로에 `'` 가 있으면 `'\''` 로 분해
    expect(printConfig({ client: "claude-code", root: "a'b c" })).toContain(`--root 'a'\\''b c'`);
    // 단순 경로는 인용하지 않는다
    expect(printConfig({ client: "agy", root: "/opt/vault_1.2" })).toBe(`# agy — 플래그는 name 앞, '-'로 시작하는 인자 앞에 '--'\nagy mcp add llmwiki -- npx -y obsidian-llmwiki-mcp --root /opt/vault_1.2\n`);
  });

  it("P2-26 JSON 계열은 주석 제거 후 유효 JSON — vscode 는 servers, 나머지는 mcpServers", () => {
    for (const client of JSON_CLIENTS) {
      for (const v of VARIANTS) {
        const j = parseJsonBody(printConfig(opts(client, v)));
        const top = Object.keys(j);
        expect(top).toEqual([client === "vscode" ? "servers" : "mcpServers"]);
        expect(Object.keys(j[top[0]])).toEqual(["llmwiki"]);
      }
    }
    const vs = parseJsonBody(printConfig(opts("vscode", "default"))).servers.llmwiki;
    expect(vs.type).toBe("stdio");
    expect(vs.args).toEqual(["-y", "obsidian-llmwiki-mcp", "--root", ROOT]);
  });

  it("P2-26 cursor/windsurf/claude-desktop 은 env.LLMWIKI_ROOT 로 경로 전달(args 에 --root 없음)", () => {
    for (const client of ["cursor", "windsurf", "claude-desktop"] as ClientName[]) {
      for (const v of VARIANTS) {
        const e = parseJsonBody(printConfig(opts(client, v))).mcpServers.llmwiki;
        expect((e.env as Record<string, string>).LLMWIKI_ROOT).toBe(ROOT);
        expect(e.args as string[]).not.toContain("--root");
      }
    }
    // gemini/vscode 는 POSIX 에서 args 에 --root, Windows 에서는 env
    for (const client of ["gemini", "vscode"] as ClientName[]) {
      const key = client === "vscode" ? "servers" : "mcpServers";
      const e = parseJsonBody(printConfig(opts(client, "default")))[key].llmwiki;
      expect((e.args as string[]).slice(-2)).toEqual(["--root", ROOT]);
      expect(e.env).toBeUndefined();
      const w = parseJsonBody(printConfig(opts(client, "windows")))[key].llmwiki;
      expect((w.env as Record<string, string>).LLMWIKI_ROOT).toBe(ROOT);
      expect(w.args as string[]).not.toContain("--root");
    }
  });

  it("P2-26 codex TOML 조각은 command/args/startup_timeout_sec 3행(+ Windows 는 env 테이블)", () => {
    const out = printConfig(opts("codex", "default"));
    expect(out).toContain("[mcp_servers.llmwiki]\n");
    expect(out).toMatch(/^command = "npx"$/m);
    expect(out).toMatch(/^startup_timeout_sec = 60$/m);
    expect(out).toContain(`args = ["-y", "obsidian-llmwiki-mcp", "--root", ${RJ}]`);
    expect(out).not.toContain("[mcp_servers.llmwiki.env]");
    const w = printConfig(opts("codex", "windows"));
    expect(w).toMatch(/^\[mcp_servers\.llmwiki\.env\]$/m);
    expect(w).toMatch(/^LLMWIKI_ROOT = ".*"$/m);
  });

  it("P2-26 codex 등록 명령에는 -c 플래그가 없다(P3 실측: -c 조합은 invalid transport 로 실패) — 타임아웃은 config.toml 안내", () => {
    const out = printConfig(opts("codex", "default"));
    expect(out).toContain("codex mcp add llmwiki -- ");
    expect(out).not.toContain("mcp add llmwiki -c ");
    expect(out).toContain("startup_timeout_sec = 60");
    expect(out).toMatch(/invalid transport/);
  });

  it("P2-26 --name 으로 서버 이름 변경", () => {
    const out = printConfig({ client: "cursor", root: ROOT, name: "mywiki" });
    expect(parseJsonBody(out).mcpServers.mywiki).toBeDefined();
    expect(printConfig({ client: "codex", root: ROOT, name: "mywiki" })).toContain("codex mcp add mywiki -- ");
    expect(printConfig({ client: "codex", root: ROOT, name: "mywiki" })).toContain("[mcp_servers.mywiki]\n");
    expect(printConfig({ client: "codex", root: ROOT, name: "mywiki", windows: true })).toContain("[mcp_servers.mywiki.env]\n");
  });
});

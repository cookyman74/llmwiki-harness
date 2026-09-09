/**
 * P2 외부 보안리뷰(2026-09-09) 수정 검증 — print-config.ts.
 *   서버 이름 주입 방지(SERVER_NAME_RE) · 볼트 경로 개행/NUL 거부 · Windows 는 경로를 명령 인자에 절대 넣지 않음(cmd 메타문자)
 *   · POSIX shq 이스케이프 · --global 은 npx 없이 실행.
 * 각 it 제목은 리뷰 finding 을 그대로 적는다.
 */
import { describe, expect, it } from "vitest";
import { CLIENTS, PrintConfigError, SERVER_NAME_RE, printConfig, shq, type ClientName } from "../../src/print-config.js";

const ROOT = "/Users/x y/OneDrive-개인/llmwiki.obsidian";
const JSON_CLIENTS: ClientName[] = ["gemini", "cursor", "windsurf", "claude-desktop", "vscode"];
const SHELL_CLIENTS: ClientName[] = ["claude-code", "codex", "agy"];

/** 주석(#) 줄을 제외한 본문 줄. */
const bodyLines = (out: string): string[] => out.split("\n").filter((ln) => !ln.startsWith("#"));

describe("review: print-config server name injection", () => {
  it("BLOCKER: name 'x; whoami' is rejected with PrintConfigError (name is interpolated into shell lines)", () => {
    expect(() => printConfig({ client: "claude-code", root: ROOT, name: "x; whoami" })).toThrow(PrintConfigError);
    expect(() => printConfig({ client: "claude-code", root: ROOT, name: "x; whoami" })).toThrow(/invalid server name/);
  });

  it("BLOCKER: name 'x] ; evil=true' is rejected (name is interpolated into the codex TOML table header)", () => {
    expect(() => printConfig({ client: "codex", root: ROOT, name: "x] ; evil=true" })).toThrow(PrintConfigError);
    expect(() => printConfig({ client: "codex", root: ROOT, name: "x]\n[evil" })).toThrow(PrintConfigError);
  });

  it("BLOCKER: empty name and other out-of-alphabet names are rejected; the safe alphabet is accepted", () => {
    for (const bad of ["", " ", "1abc", "-abc", "_abc", "a b", "a.b", "a/b", "a$b", "a`b", "a\"b", "한글", "a".repeat(65)]) {
      expect(() => printConfig({ client: "cursor", root: ROOT, name: bad }), JSON.stringify(bad)).toThrow(PrintConfigError);
      expect(SERVER_NAME_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const ok of ["llmwiki", "my_wiki-2", "A", "a".repeat(64), "Z9_-"]) {
      expect(SERVER_NAME_RE.test(ok), ok).toBe(true);
      const out = printConfig({ client: "cursor", root: ROOT, name: ok });
      expect(out).toContain(`"${ok}": {`);
    }
    expect(SERVER_NAME_RE.source).toBe("^[A-Za-z][A-Za-z0-9_-]{0,63}$");
  });

  it("BLOCKER: the rejection applies to every client (name reaches shell, JSON and TOML alike)", () => {
    for (const client of CLIENTS) {
      expect(() => printConfig({ client, root: ROOT, name: "x; whoami" }), client).toThrow(PrintConfigError);
    }
  });
});

describe("review: print-config vault root validation", () => {
  it("MAJOR: root containing a newline is rejected (would split the shell/TOML line)", () => {
    for (const client of CLIENTS) {
      expect(() => printConfig({ client, root: "/tmp/a\nevil=true" }), client).toThrow(PrintConfigError);
      expect(() => printConfig({ client, root: "/tmp/a\nevil=true" }), client).toThrow(/newline or NUL/);
      expect(() => printConfig({ client, root: "/tmp/a\rb" }), client).toThrow(PrintConfigError);
      expect(() => printConfig({ client, root: "/tmp/a\0b" }), client).toThrow(PrintConfigError);
    }
  });

  it("empty / whitespace-only root is rejected", () => {
    expect(() => printConfig({ client: "agy", root: "" })).toThrow(/vault root is empty/);
    expect(() => printConfig({ client: "agy", root: "   " })).toThrow(PrintConfigError);
  });
});

describe("review: --windows never places the vault path in command args", () => {
  const WIN_ROOT = "C:\\wiki\\safe&whoami"; // cmd /c 가 해석하는 `&` 포함
  const MARK = "safe&whoami";

  it("BLOCKER: for all 8 clients, windows output has no --root and the path appears only inside an env assignment or JSON env block", () => {
    for (const client of CLIENTS) {
      const out = printConfig({ client, root: WIN_ROOT, windows: true });
      expect(out, client).not.toContain("--root");
      expect(out, client).toContain("LLMWIKI_ROOT");
      const lines = bodyLines(out).filter((ln) => ln.includes(MARK));
      expect(lines.length, `${client}: path must appear at least once`).toBeGreaterThan(0);
      for (const ln of lines) {
        // 셸 `--env "LLMWIKI_ROOT=…"` / `-e "LLMWIKI_ROOT=…"` · TOML `LLMWIKI_ROOT = "…"` · JSON `"LLMWIKI_ROOT": "…"`
        expect(ln, `${client}: ${ln}`).toMatch(/"LLMWIKI_ROOT=[^"]*"|^LLMWIKI_ROOT = "[^"]*"$|^\s*"LLMWIKI_ROOT": "[^"]*",?$/);
      }
    }
  });

  it("BLOCKER: a root like C:\\wiki\\safe&whoami never appears (quoted or not) in the `cmd /c …` command line", () => {
    for (const client of SHELL_CLIENTS) {
      const out = printConfig({ client, root: WIN_ROOT, windows: true });
      expect(out, client).not.toContain("--root");
      const cmdLines = bodyLines(out).filter((ln) => ln.includes(" -- cmd "));
      expect(cmdLines.length, client).toBe(1);
      const afterSep = cmdLines[0].split(" -- ")[1];
      expect(afterSep, client).toBe("cmd /c npx -y llmwiki-mcp"); // 경로 토큰 없음
      expect(afterSep, client).not.toContain("whoami");
      // 경로는 오직 인용된 --env/-e 값 안에만 — `&` 가 벗은 채 셸에 닿지 않는다
      expect(cmdLines[0], client).toMatch(/(--env|-e) "LLMWIKI_ROOT=C:\\wiki\\safe&whoami" /); // 원래 정규식의 \\\\ 는 백슬래시 2개를 요구해 절대 매치되지 않았다(마스킹된 단언)
      expect(cmdLines[0], client).not.toMatch(/[^"]LLMWIKI_ROOT=C:/);
      expect(cmdLines[0].split(MARK).length - 1, client).toBe(1); // 정확히 1회(env 값)
      // WIN_NOTE 주석(cmd.exe 인용 안내)이 명령 앞에 온다
      const lines = out.split("\n");
      expect(lines[lines.indexOf(cmdLines[0]) - 1], client).toMatch(/^# \(cmd\.exe 는 큰따옴표 안에서도 %VAR% 를 확장/);
    }
    for (const client of JSON_CLIENTS) {
      const j = JSON.parse(bodyLines(printConfig({ client, root: WIN_ROOT, windows: true })).join("\n")) as Record<string, Record<string, { command: string; args: string[]; env: Record<string, string> }>>;
      const e = j[client === "vscode" ? "servers" : "mcpServers"].llmwiki;
      expect(e.command, client).toBe("cmd");
      expect(e.args, client).toEqual(["/c", "npx", "-y", "llmwiki-mcp"]);
      expect(e.env.LLMWIKI_ROOT, client).toBe(WIN_ROOT);
    }
    // codex TOML: args 에 경로 없음, env 테이블에만
    const codex = printConfig({ client: "codex", root: WIN_ROOT, windows: true });
    expect(codex).toContain(`args = ["/c", "npx", "-y", "llmwiki-mcp"]\n`);
    expect(codex).toContain(`[mcp_servers.llmwiki.env]\nLLMWIKI_ROOT = ${JSON.stringify(WIN_ROOT)}\n`);
  });

  it("BLOCKER: windows + global also keeps the path out of args", () => {
    for (const client of CLIENTS) {
      const out = printConfig({ client, root: WIN_ROOT, windows: true, global: true });
      expect(out, client).not.toContain("--root");
      expect(bodyLines(out).join("\n"), client).not.toContain("npx");
      const cmdLines = bodyLines(out).filter((l) => l.includes(" -- cmd "));
      if (SHELL_CLIENTS.includes(client)) expect(cmdLines.length, client).toBe(1);
      for (const ln of cmdLines) expect(ln.split(" -- ")[1], client).toBe("cmd /c llmwiki-mcp");
    }
  });

  it("MAJOR (3차 정정): %VAR% / ! in the root → CLI-form Windows registration is REFUSED (cmd.exe expands % even inside quotes; %% is not an escape at the prompt); JSON/TOML forms keep the raw value in env", () => {
    const tricky = "C:\\Users\\%USERNAME%\\!vault";
    for (const client of SHELL_CLIENTS) {
      expect(() => printConfig({ client, root: tricky, windows: true }), client).toThrow(PrintConfigError);
      expect(() => printConfig({ client, root: tricky, windows: true }), client).toThrow(/JSON-config/);
      // POSIX(비 windows) CLI 형은 % 가 특수문자가 아니므로 허용
      expect(() => printConfig({ client, root: tricky }), client).not.toThrow();
    }
    const pathRoot = "C:\\wiki\\%PATH%";
    for (const client of SHELL_CLIENTS) expect(() => printConfig({ client, root: pathRoot, windows: true }), client).toThrow(PrintConfigError);
    // 경고 주석은 안전한 경로의 CLI 형 출력에도 항상 붙는다
    const safe = printConfig({ client: "codex", root: "C:\\wiki\\safe", windows: true });
    expect(safe).toMatch(/^# .*%VAR%.*!VAR!.*JSON 설정형/m);
    for (const client of JSON_CLIENTS) {
      const j = JSON.parse(bodyLines(printConfig({ client, root: pathRoot, windows: true })).join("\n")) as Record<string, Record<string, { env: Record<string, string> }>>;
      expect(j[client === "vscode" ? "servers" : "mcpServers"].llmwiki.env.LLMWIKI_ROOT, client).toBe(pathRoot);
    }
  });
});

describe("review: POSIX shell quoting (shq)", () => {
  // 3차 리뷰(codex MINOR-7): 큰따옴표 인용은 `$`·백틱·`!` 를 셸이 여전히 해석한다 → **작은따옴표**로 전환.
  it("MAJOR: shq wraps in single quotes — `\"`/`\\`/`$`/backtick 은 그대로, `'` 만 '\\'' 로 분해", () => {
    expect(shq('a b"c$d`e\\f')).toBe(`'a b"c$d\`e\\f'`);
    expect(shq('"')).toBe(`'"'`);
    expect(shq("\\")).toBe("'\\'");
    expect(shq("$HOME")).toBe("'$HOME'");
    expect(shq("`id`")).toBe("'`id`'");
    expect(shq("$(whoami)")).toBe("'$(whoami)'");
    expect(shq("a'b")).toBe(`'a'\\''b'`);
    expect(shq("'")).toBe(`''\\'''`);
    expect(shq("!!")).toBe("'!!'");
  });

  it("shq quotes anything outside the safe alphabet (space, ;, &, |, Hangul) and leaves safe tokens bare", () => {
    for (const s of ["/opt/vault_1.2", "npx", "-y", "llmwiki-mcp", "mcp_servers.llmwiki.startup_timeout_sec=60", "a:b+c"]) expect(shq(s), s).toBe(s);
    for (const s of ["a b", "a;b", "a&b", "a|b", "a>b", "개인", "a'b", "", "*", "~", "$HOME", "`id`", "a!b"]) {
      const q = shq(s);
      expect(q.startsWith("'") && q.endsWith("'"), JSON.stringify(s)).toBe(true);
      expect(q, JSON.stringify(s)).not.toContain('"'); // 큰따옴표 인용은 더 이상 쓰지 않는다
    }
  });

  it("MAJOR: the escaped path is what the POSIX shell lines carry (no bare `\"`/`$` reaches the command)", () => {
    const root = 'v"$(whoami)`id`\\x';
    for (const client of SHELL_CLIENTS) {
      const out = printConfig({ client, root });
      const [cmd] = bodyLines(out).filter((ln) => ln.includes(" -- "));
      expect(cmd, client).toContain(`--root ${shq(root)}`);
      expect(cmd, client).not.toContain(`--root ${root}`);
    }
  });
});

describe("review: --global uses llmwiki-mcp without npx", () => {
  it("MINOR: every client's --global body has no npx and runs llmwiki-mcp directly", () => {
    for (const client of CLIENTS) {
      const body = bodyLines(printConfig({ client, root: ROOT, global: true })).join("\n");
      expect(body, client).not.toContain("npx");
      expect(body, client).toContain("llmwiki-mcp");
    }
    expect(printConfig({ client: "agy", root: "/opt/v", global: true })).toContain("agy mcp add llmwiki -- llmwiki-mcp --root /opt/v\n");
    expect(printConfig({ client: "codex", root: "/opt/v", global: true })).toContain('command = "llmwiki-mcp"\nargs = ["--root", "/opt/v"]');
    // Windows CLI 형: WIN_NOTE 주석은 bodyLines 에서 빠지고, 명령 줄은 cmd /c 로 llmwiki-mcp 직접 실행
    const winGlobal = printConfig({ client: "claude-code", root: "/opt/v", global: true, windows: true });
    expect(winGlobal).toContain(" -- cmd /c llmwiki-mcp\n");
    expect(bodyLines(winGlobal).join("\n")).not.toContain("npx");
  });
});

/**
 * 3차 외부리뷰 MINOR-7 — "POSIX CLI 형이 큰따옴표로 인용해 `$`·백틱·`!` 가 셸에서 살아있다".
 *
 * 수정 후 계약: `shq()` 는 안전 토큰(`[A-Za-z0-9_./:=+-]+`)만 그대로 두고, 나머지는 **작은따옴표**로 감싼다(`'` → `'\''`).
 * 작은따옴표 안에서는 셸이 아무것도 해석하지 않으므로 `$HOME`·`` `id` ``·`$(whoami)`·`!!` 가 전부 문자 그대로 남는다.
 * 계약을 말로만 두지 않고 **실제 `sh -c "printf %s …"` 로 왕복**시켜 원문이 그대로 돌아오는지 확인한다(win32 는 sh 가 없어 skip).
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { printConfig, shq } from "../../src/print-config.js";

const HAVE_SH = process.platform !== "win32";

/** 셸이 실제로 어떻게 읽는지 — 인용된 토큰 하나를 printf 로 되돌려 받는다. */
function shEcho(quoted: string): string {
  const r = spawnSync("sh", ["-c", `printf %s ${quoted}`], { encoding: "utf8", timeout: 30_000 });
  expect(r.error, String(r.error)).toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

/** 인용 토큰 여러 개를 줄 단위로 되돌려 받는다(명령 줄 전체 검증용). */
function shEchoTokens(quotedLine: string): string[] {
  const r = spawnSync("sh", ["-c", `printf '%s\\n' ${quotedLine}`], { encoding: "utf8", timeout: 30_000 });
  expect(r.error, String(r.error)).toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split("\n").slice(0, -1);
}

// 경로에 실제로 나타날 수 있는(그리고 큰따옴표에서 위험했던) 표본
const SAMPLES = [
  "/Users/x y/OneDrive-개인/llmwiki.obsidian",
  "$HOME",
  "/vault/$USER/notes",
  "`id`",
  "$(whoami)",
  "!!",
  "/vault/hello!/notes",
  "a'b",
  "'",
  "''",
  'a"b',
  "a\\b",
  "a b\tc",
  "*",
  "~",
  "a;b|c&d>e",
  "vault (2)",
  "개인 노트",
  "€ ☃ 𝔘",
  "-leading-dash but spaced",
];

describe("3차 MINOR-7: shq 는 작은따옴표로 인용한다", () => {
  it("안전 토큰은 인용하지 않는다 — 안전 집합은 [A-Za-z0-9_./:=+-]", () => {
    for (const s of ["npx", "-y", "obsidian-llmwiki-mcp", "/opt/vault_1.2", "mcp_servers.llmwiki.startup_timeout_sec=60", "a:b+c", "A/b-c_d.e:f=g+h"]) {
      expect(shq(s), s).toBe(s);
    }
  });

  it("안전하지 않은 토큰은 작은따옴표로 감싼다 — 내부 문자는 이스케이프하지 않는다", () => {
    expect(shq("a b")).toBe("'a b'");
    expect(shq("$HOME")).toBe("'$HOME'");
    expect(shq("`id`")).toBe("'`id`'");
    expect(shq("$(whoami)")).toBe("'$(whoami)'");
    expect(shq("!!")).toBe("'!!'");
    expect(shq('a"b')).toBe(`'a"b'`); // 큰따옴표도 그냥 문자
    expect(shq("a\\b")).toBe("'a\\b'"); // 역슬래시도 그냥 문자 — 두 배로 늘리지 않는다
    expect(shq("")).toBe("''"); // 빈 문자열도 토큰 하나로 남아야 한다
    expect(shq("개인")).toBe("'개인'");
  });

  it("작은따옴표는 '\\'' 로 분해한다 — 인용 이탈 불가", () => {
    expect(shq("a'b")).toBe(`'a'\\''b'`);
    expect(shq("'")).toBe(`''\\'''`);
    expect(shq("''")).toBe(`''\\'''\\'''`);
    expect(shq("a'; whoami; '")).toBe(`'a'\\''; whoami; '\\'''`);
    // 인용 결과에 큰따옴표 인용은 절대 쓰이지 않는다
    for (const s of SAMPLES) expect(shq(s).startsWith("'") && shq(s).endsWith("'"), JSON.stringify(s)).toBe(true);
  });

  it.skipIf(!HAVE_SH)("왕복: sh -c \"printf %s <quoted>\" 가 원문을 그대로 돌려준다", () => {
    for (const s of [...SAMPLES, "npx", "-y", "/opt/vault_1.2"]) {
      expect(shEcho(shq(s)), JSON.stringify(s)).toBe(s);
    }
  });

  it.skipIf(!HAVE_SH)("`!`·`$`·백틱 root 는 완전히 불활성 — 부작용 없이 문자 그대로 남는다", () => {
    // 명령 치환이 실제로 일어났다면 사용자명·프로세스 출력이 섞여 원문과 달라진다
    for (const s of ["$(touch /tmp/llmwiki-should-not-exist)", "`touch /tmp/llmwiki-should-not-exist`", "$HOME/vault", "!$", "!!", "${IFS}"]) {
      expect(shEcho(shq(s)), s).toBe(s);
    }
    expect(spawnSync("sh", ["-c", "test -e /tmp/llmwiki-should-not-exist"], { encoding: "utf8" }).status, "명령 치환이 실행됐다").not.toBe(0);
  });

  it.skipIf(!HAVE_SH)("print-config 의 POSIX CLI 줄은 셸이 읽어도 토큰이 보존된다", () => {
    const root = "/Users/x y/OneDrive-개인/llmwiki$HOME`id`'q'.obsidian";
    for (const client of ["claude-code", "codex", "agy"] as const) {
      const line = printConfig({ client, root })
        .split("\n")
        .find((ln) => !ln.startsWith("#") && ln.includes(" -- "));
      expect(line, client).toBeDefined();
      const tokens = shEchoTokens((line as string).split(" -- ")[1]);
      expect(tokens.slice(-2), client).toEqual(["--root", root]); // 경로가 한 토큰으로, 원문 그대로
    }
  });
});

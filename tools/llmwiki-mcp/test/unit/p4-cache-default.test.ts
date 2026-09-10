/**
 * 배선 점검(2026-09-10) — 캐시 기본값이 실행 형태에 맞게 연결됐는지.
 *
 * 서버(장수 프로세스)는 켜고, 1회성 실행(`--once`·`--selftest`)은 끈다. 1회성 프로세스는 적중할 기회가
 * 없어 stat 스캔 비용만 더해지기 때문이다. `LLMWIKI_CACHE` 가 명시되면 그게 항상 우선한다.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cacheEnabled, setCacheDefault } from "../../src/cache.js";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "..", "dist", "cli.js");
const VAULT = path.join(HERE, "..", "fixtures", "vault");

afterEach(() => {
  delete process.env.LLMWIKI_CACHE;
  setCacheDefault(true);
});

describe("캐시 기본값·환경변수 우선순위", () => {
  it("미지정이면 기본값을 따르고, 0/1 은 기본값보다 우선한다", () => {
    delete process.env.LLMWIKI_CACHE;
    setCacheDefault(true);
    expect(cacheEnabled()).toBe(true);
    setCacheDefault(false);
    expect(cacheEnabled()).toBe(false);
    process.env.LLMWIKI_CACHE = "1";
    expect(cacheEnabled()).toBe(true); // 1회성 기본값이 꺼져 있어도 강제로 켠다
    setCacheDefault(true);
    process.env.LLMWIKI_CACHE = "0";
    expect(cacheEnabled()).toBe(false);
  });

  it("알 수 없는 값은 명시로 보지 않고 기본값을 따른다", () => {
    process.env.LLMWIKI_CACHE = "yes";
    setCacheDefault(false);
    expect(cacheEnabled()).toBe(false);
  });
});

describe.skipIf(!existsSync(CLI))("CLI 배선 — dist 가 있을 때만(npm run check 는 build 후 test)", () => {
  const env = (v?: string): NodeJS.ProcessEnv => {
    const e = { ...process.env };
    delete e.LLMWIKI_CACHE;
    delete e.LLMWIKI_DEBUG;
    if (v !== undefined) e.LLMWIKI_CACHE = v;
    return e;
  };

  it("--once expand 출력은 캐시 기본(off)·강제 on·강제 off 에서 모두 같다", async () => {
    const args = [CLI, "--once", "expand", "alpha", "--root", VAULT, "--rerank", "11"];
    const [a, b, c] = await Promise.all([undefined, "1", "0"].map((v) => run("node", args, { env: env(v) })));
    expect(b.stdout).toBe(a.stdout);
    expect(c.stdout).toBe(a.stdout);
  });

  it("--help 의 Env 줄에 LLMWIKI_CACHE 가 있다(README 와 실제 출력 일치)", async () => {
    const { stdout } = await run("node", [CLI, "--help"], { env: env() });
    expect(stdout).toContain("LLMWIKI_CACHE=0|1");
  });
});

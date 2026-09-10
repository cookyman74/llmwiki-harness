/**
 * P2 외부 보안리뷰 2차(codex r2 / agy r2, 2026-09-09) 수정 검증.
 *   root.ts(resolveRoot: wiki/ 심볼릭 링크 거부·realpath 비노출·LLMWIKI_ROOT 폴백·rootLabel) · server.ts(세마포어 슬롯 인계)
 *   · tools.ts(원시 입력 가드 RAW_INPUT_MAX_CHARS/RAW_ARRAY_MAX_ITEMS · validateSubset strict) · vault.ts(MAX_DIRS/MAX_DEPTH/MAX_TOTAL_BYTES)
 *   · print-config.ts(cmdq) · cli.ts(print-config 우선순위·parsePrintConfig).
 * 각 it 제목은 리뷰 finding 을 그대로 적는다. CLI 검사는 dist/cli.js 를 spawn 한다(없으면 skip). 심볼릭 링크 생성이 안 되는
 * 플랫폼(win32 권한 없음)에서는 링크 관련 케이스를 skip 한다.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cmdq } from "../../src/print-config.js";
import { RootError, resolveRoot, rootLabel } from "../../src/root.js";
import { MAX_CONCURRENT_CALLS, callTool, concurrencyState } from "../../src/server.js";
import { RAW_ARRAY_MAX_ITEMS, RAW_INPUT_MAX_CHARS, TOOLS, ToolInputError, normalizeSlug, normalizeSlugs, normalizeTerms, validateSubset, type JsonSchema } from "../../src/tools.js";
import { MAX_DEPTH, MAX_DIRS, MAX_FILES, MAX_TOTAL_BYTES, VaultLimitError, walkMd } from "../../src/vault.js";
import { DIST_CLI, FIXTURE_VAULT, text } from "./p2-helpers.js";

const HAVE_DIST = existsSync(DIST_CLI);
const tmpDirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LLMWIKI_ROOT;
  delete env.LLMWIKI_DEBUG;
  return env;
}
function run(args: string[], env: NodeJS.ProcessEnv = cleanEnv()): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [DIST_CLI, ...args], { encoding: "utf8", env, timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
/** resolveRoot 가 거부해야 하는 케이스 — RootError 를 돌려주고, 통과하면 실패. */
async function rootErr(p: Promise<string>): Promise<RootError> {
  try {
    const real = await p;
    throw new Error(`expected RootError but resolved: ${real}`);
  } catch (e) {
    if (e instanceof RootError) return e;
    throw e;
  }
}
const labelOf = (real: string): string => `${path.basename(real)} (sha256:${createHash("sha256").update(real).digest("hex").slice(0, 8)})`;

/** 링크 생성 시도 — win32 에서 권한이 없으면 false(관련 케이스 skip). */
async function tryLink(target: string, link: string, type: "dir" | "file" = "dir"): Promise<boolean> {
  try {
    await symlink(target, link, type);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
describe("codex r2 BLOCKER-1: root/wiki must be a real directory — a symlinked wiki/ is refused by resolveRoot, --selftest and --once", () => {
  let base = "";
  let rootLinked = ""; // <root>/wiki → 외부 디렉터리(secret.md)
  let rootInnerLink = ""; // <root>/wiki → <root>/real-wiki (내부지만 링크)
  let rootReal = ""; // <root>/wiki 가 진짜 디렉터리
  let rootWikiFile = ""; // <root>/wiki 가 일반 파일
  let outside = "";
  let linkOk = false;

  beforeAll(async () => {
    base = await tmp("llmwiki-r2-wikilink-");
    outside = path.join(base, "leaked-secret-dir");
    await mkdir(path.join(outside, "L3-semantic"), { recursive: true });
    await writeFile(path.join(outside, "L3-semantic", "secret.md"), "---\ntype: fact\n---\n- claim:: secret token hunter2\n", "utf8");
    rootLinked = path.join(base, "root-linked");
    await mkdir(rootLinked);
    linkOk = await tryLink(outside, path.join(rootLinked, "wiki"));
    rootInnerLink = path.join(base, "root-inner");
    await mkdir(path.join(rootInnerLink, "real-wiki"), { recursive: true });
    if (linkOk) linkOk = await tryLink(path.join(rootInnerLink, "real-wiki"), path.join(rootInnerLink, "wiki"));
    rootReal = path.join(base, "root-real");
    await mkdir(path.join(rootReal, "wiki", "L3-semantic"), { recursive: true });
    await writeFile(path.join(rootReal, "wiki", "L3-semantic", "secret.md"), "---\ntype: fact\n---\n- claim:: secret token hunter2\n", "utf8");
    rootWikiFile = path.join(base, "root-wikifile");
    await mkdir(rootWikiFile);
    await writeFile(path.join(rootWikiFile, "wiki"), "not a dir", "utf8");
  });

  it("resolveRoot rejects a root whose wiki/ is a symlink to an outside dir (RootError, exit code 2, message names only the user string)", async () => {
    if (!linkOk) return;
    await expect(resolveRoot(rootLinked)).rejects.toBeInstanceOf(RootError);
    const err = await rootErr(resolveRoot(rootLinked));
    expect(err).toBeInstanceOf(RootError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/refusing vault whose wiki\/ is a symbolic link/);
    expect(err.message).toContain(JSON.stringify(rootLinked)); // 사용자가 넘긴 문자열 그대로
    expect(err.message).not.toContain("leaked-secret-dir"); // 링크 대상(realpath) 비노출
    expect(err.message).not.toContain("secret.md");
  });

  it("resolveRoot also rejects wiki/ that is a symlink to a directory INSIDE the root (lstat, not just boundary)", async () => {
    if (!linkOk) return;
    await expect(resolveRoot(rootInnerLink)).rejects.toThrow(/symbolic link/);
    await expect(resolveRoot(rootInnerLink)).rejects.toBeInstanceOf(RootError);
  });

  it("resolveRoot accepts a root whose wiki/ is a real directory and returns its realpath", async () => {
    await expect(resolveRoot(rootReal)).resolves.toBe(await realpath(rootReal));
    await expect(resolveRoot(FIXTURE_VAULT)).resolves.toBe(FIXTURE_VAULT);
  });

  it("resolveRoot rejects wiki that is a regular file / a root without wiki/ / a nonexistent root — all RootError without realpath in the message", async () => {
    await expect(resolveRoot(rootWikiFile)).rejects.toThrow(/wiki is not a directory/);
    await expect(resolveRoot(base)).rejects.toThrow(/missing wiki\/ directory/);
    const nowhere = path.join(base, "does-not-exist");
    await expect(resolveRoot(nowhere)).rejects.toThrow(/not found or not a directory/);
    const filePath = path.join(rootWikiFile, "wiki"); // 파일을 root 로
    await expect(resolveRoot(filePath)).rejects.toThrow(/not found or not a directory/);
    for (const bad of [rootWikiFile, base, nowhere, filePath]) {
      const err = await rootErr(resolveRoot(bad));
      expect(err, bad).toBeInstanceOf(RootError);
      expect(err.message, bad).toContain(JSON.stringify(bad));
    }
  });

  it.skipIf(!HAVE_DIST)("`--selftest --root <root with symlinked wiki>` exits 2 with nothing on stdout; a real wiki/ root exits 0", () => {
    if (!linkOk) return;
    const bad = run(["--selftest", "--root", rootLinked]);
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toMatch(/symbolic link/);
    expect(bad.stderr).not.toContain("leaked-secret-dir");
    expect(bad.stderr.trim().split("\n")).toHaveLength(1);
    const ok = run(["--selftest", "--root", rootReal]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("pages: 1");
  });

  it.skipIf(!HAVE_DIST)("`--once search secret --root <root with symlinked wiki>` exits 2 with EMPTY stdout (the outside page is never read); the real root finds it", () => {
    if (!linkOk) return;
    const bad = run(["--once", "search", "secret", "--root", rootLinked]);
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toMatch(/symbolic link/);
    expect(bad.stderr).not.toContain("hunter2");
    expect(bad.stderr).not.toContain("leaked-secret-dir");
    const inner = run(["--once", "search", "secret", "--root", rootInnerLink]);
    expect(inner.status).toBe(2);
    expect(inner.stdout).toBe("");
    const ok = run(["--once", "search", "secret", "--root", rootReal]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("secret");
    // expand / pack 도 같은 resolveRoot 를 탄다
    for (const mode of ["expand", "pack"]) {
      const r = run(["--once", mode, "secret", "--root", rootLinked]);
      expect(r.status, mode).toBe(2);
      expect(r.stdout, mode).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("codex r2 MAJOR-5: resolveRoot is shared — LLMWIKI_ROOT fallback, missing root → exit 2, root symlink allowed, realpath never leaks", () => {
  let base = "";
  let linkToFixture = "";
  let linkToNoWiki = "";
  let noWikiTarget = "";
  let linkOk = false;
  beforeAll(async () => {
    base = await tmp("llmwiki-r2-rootlink-");
    linkToFixture = path.join(base, "link-to-fixture");
    linkOk = await tryLink(FIXTURE_VAULT, linkToFixture);
    noWikiTarget = path.join(base, "target-without-wiki-dir");
    await mkdir(noWikiTarget);
    linkToNoWiki = path.join(base, "link-to-nowiki");
    if (linkOk) linkOk = await tryLink(noWikiTarget, linkToNoWiki);
  });
  const savedEnv = process.env.LLMWIKI_ROOT;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.LLMWIKI_ROOT;
    else process.env.LLMWIKI_ROOT = savedEnv;
  });

  it("resolveRoot(undefined) falls back to LLMWIKI_ROOT; with neither → RootError 'vault root required' (exit 2)", async () => {
    delete process.env.LLMWIKI_ROOT;
    const err = await rootErr(resolveRoot(undefined));
    expect(err).toBeInstanceOf(RootError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/vault root required/);
    process.env.LLMWIKI_ROOT = "";
    await expect(resolveRoot(undefined)).rejects.toThrow(/vault root required/); // 빈 문자열도 미설정으로 취급
    process.env.LLMWIKI_ROOT = FIXTURE_VAULT;
    await expect(resolveRoot(undefined)).resolves.toBe(FIXTURE_VAULT);
    // 명시 --root 가 env 보다 우선
    process.env.LLMWIKI_ROOT = base;
    await expect(resolveRoot(FIXTURE_VAULT)).resolves.toBe(FIXTURE_VAULT);
    await expect(resolveRoot(undefined)).rejects.toThrow(/missing wiki\//);
  });

  it.skipIf(!HAVE_DIST)("`--once search rerank` with LLMWIKI_ROOT set works (same stdout as --root); with neither → exit 2, empty stdout", () => {
    const viaEnv = run(["--once", "search", "rerank"], { ...cleanEnv(), LLMWIKI_ROOT: FIXTURE_VAULT });
    expect(viaEnv.status, viaEnv.stderr).toBe(0);
    expect(viaEnv.stdout).toContain("concept-reranking");
    const viaFlag = run(["--once", "search", "rerank", "--root", FIXTURE_VAULT]);
    expect(viaFlag.stdout).toBe(viaEnv.stdout);
    const none = run(["--once", "search", "rerank"]);
    expect(none.status).toBe(2);
    expect(none.stdout).toBe("");
    expect(none.stderr).toMatch(/vault root required/);
    expect(none.stderr.trim().split("\n")).toHaveLength(1);
    // --once 도 wiki/ 없는 root 는 exit 2 (서버와 같은 검증)
    const noWiki = run(["--once", "search", "rerank", "--root", base]);
    expect(noWiki.status).toBe(2);
    expect(noWiki.stdout).toBe("");
    expect(noWiki.stderr).toMatch(/missing wiki\//);
  });

  it("a root that is itself a symlink is ALLOWED (only wiki/ may not be a link) and resolves to the realpath", async () => {
    if (!linkOk) return;
    await expect(resolveRoot(linkToFixture)).resolves.toBe(FIXTURE_VAULT);
  });

  it.skipIf(!HAVE_DIST)("`--selftest --root <symlink to fixture>` exits 0 and the root: label hashes the REAL path — neither the link nor the realpath is printed", () => {
    if (!linkOk) return;
    const r = run(["--selftest", "--root", linkToFixture]);
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines[1]).toBe(`root: ${labelOf(FIXTURE_VAULT)}`);
    expect(r.stdout).not.toContain(FIXTURE_VAULT);
    expect(r.stdout).not.toContain(linkToFixture);
    expect(lines).toContain("pages: 25");
    const shown = run(["--selftest", "--root", linkToFixture, "--show-root"]);
    expect(shown.stdout.split("\n")).toContain(`root: ${FIXTURE_VAULT}`); // --show-root 는 realpath
  });

  it("error messages never contain the realpath of a symlinked input — only the user-supplied string (JSON.stringify)", async () => {
    if (!linkOk) return;
    const err = await rootErr(resolveRoot(linkToNoWiki));
    expect(err).toBeInstanceOf(RootError);
    expect(err.message).toMatch(/missing wiki\//);
    expect(err.message).toContain(JSON.stringify(linkToNoWiki));
    expect(err.message).not.toContain("target-without-wiki-dir");
    if (!HAVE_DIST) return;
    for (const args of [
      ["--selftest", "--root", linkToNoWiki],
      ["--root", linkToNoWiki],
      ["--once", "search", "x", "--root", linkToNoWiki],
    ]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stdout, args.join(" ")).toBe("");
      expect(r.stderr, args.join(" ")).toContain(JSON.stringify(linkToNoWiki));
      expect(r.stderr, args.join(" ")).not.toContain("target-without-wiki-dir");
    }
  });

  it("rootLabel(real) = basename + ' (sha256:' + first 8 hex of sha256(real) + ')'", async () => {
    expect(await rootLabel(FIXTURE_VAULT)).toBe(labelOf(FIXTURE_VAULT));
    expect(await rootLabel("/x/y/my-vault")).toMatch(/^my-vault \(sha256:[0-9a-f]{8}\)$/);
    expect(await rootLabel("/x/y/my-vault")).not.toBe(await rootLabel("/z/my-vault")); // 같은 basename 이라도 해시가 다르다
  });

  it("control characters in the user string are escaped in the message (JSON.stringify) — no raw newline reaches stderr", async () => {
    const weird = path.join(base, "no\nsuch\u001bdir");
    const err = await rootErr(resolveRoot(weird));
    expect(err).toBeInstanceOf(RootError);
    expect(err.message).not.toContain("\n");
    expect(err.message).not.toContain("\u001b");
    expect(err.message).toContain("\\n");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("agy r2 MAJOR-2: semaphore hands the slot to a waiter — inFlight never exceeds MAX_CONCURRENT_CALLS, queue cannot be overtaken", () => {
  it("12 concurrent callTool: immediately {inFlight:4, waiting:8}; every sample has inFlight ≤ 4 (== 4 while anyone waits); ends {0,0}", async () => {
    expect(concurrencyState()).toEqual({ inFlight: 0, waiting: 0 });
    const N = 12;
    let done = 0;
    const ps = Array.from({ length: N }, () => callTool(FIXTURE_VAULT, "wiki_expand", { terms: ["rerank", "bm25"], rerank: 11 }, undefined, true).finally(() => done++));
    // acquire() 는 처음 4개를 동기적으로 통과시키고 나머지는 동기적으로 큐에 넣는다
    expect(concurrencyState()).toEqual({ inFlight: MAX_CONCURRENT_CALLS, waiting: N - MAX_CONCURRENT_CALLS });
    const samples: { inFlight: number; waiting: number }[] = [];
    while (done < N) {
      samples.push(concurrencyState());
      await new Promise<void>((r) => setImmediate(r));
    }
    const results = await Promise.all(ps);
    expect(samples.length).toBeGreaterThan(0);
    let maxInFlight = 0;
    for (const s of samples) {
      expect(s.inFlight).toBeLessThanOrEqual(MAX_CONCURRENT_CALLS);
      expect(s.inFlight).toBeGreaterThanOrEqual(0);
      if (s.waiting > 0) expect(s.inFlight, `waiting=${s.waiting} but inFlight=${s.inFlight} (slot hand-off must keep inFlight at the cap)`).toBe(MAX_CONCURRENT_CALLS);
      maxInFlight = Math.max(maxInFlight, s.inFlight);
    }
    expect(maxInFlight).toBe(MAX_CONCURRENT_CALLS);
    // 대기열은 시간이 지날수록 단조 감소(추월·재진입 없음)
    for (let i = 1; i < samples.length; i++) expect(samples[i].waiting).toBeLessThanOrEqual(samples[i - 1].waiting);
    expect(concurrencyState()).toEqual({ inFlight: 0, waiting: 0 });
    for (const r of results) {
      expect(r.isError).toBeFalsy();
      expect(text(r)).toBe(text(results[0]));
    }
  });

  it("slots are released on isError results and unknown tools too — state returns to {0,0}", async () => {
    const rs = await Promise.all([
      callTool(FIXTURE_VAULT, "wiki_search", { terms: 5 }, undefined, true),
      callTool(FIXTURE_VAULT, "wiki_nope", {}, undefined, true),
      callTool(FIXTURE_VAULT, "wiki_read_page", { slug: "no-such-page-xyz" }, undefined, true),
      callTool(FIXTURE_VAULT, "wiki_pack", { slugs: [] }, undefined, true),
      callTool(FIXTURE_VAULT, "wiki_expand", { terms: ["rerank"], max: 999 }, undefined, true),
      callTool(FIXTURE_VAULT, "wiki_search", { terms: ["rerank"] }, undefined, true),
    ]);
    expect(rs.slice(0, 5).every((r) => r.isError)).toBe(true);
    expect(rs[5].isError).toBeFalsy();
    expect(concurrencyState()).toEqual({ inFlight: 0, waiting: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("codex r2 #3: raw input guards run BEFORE splitting/iterating (RAW_INPUT_MAX_CHARS / RAW_ARRAY_MAX_ITEMS)", () => {
  it("constants: RAW_INPUT_MAX_CHARS === 4096, RAW_ARRAY_MAX_ITEMS === 256", () => {
    expect(RAW_INPUT_MAX_CHARS).toBe(4096);
    expect(RAW_ARRAY_MAX_ITEMS).toBe(256);
  });

  it("terms string of 5000 chars → ToolInputError 'terms too long' before the whitespace split (not 'too many terms')", () => {
    const s = "a ".repeat(2500); // 5000 chars → 분할하면 2500 terms
    expect(s.length).toBe(5000);
    expect(() => normalizeTerms(s)).toThrow(ToolInputError);
    expect(() => normalizeTerms(s)).toThrow(/terms too long \(>4096 chars\)/);
    expect(() => normalizeTerms(s)).not.toThrow(/too many terms/);
    // 경계: 4096 자는 가드 통과 → 그 다음 단계(분할 후 개수 검사)에서 걸린다
    const edge = "ab ".repeat(1365) + "a";
    expect(edge.length).toBe(4096);
    expect(() => normalizeTerms(edge)).toThrow(/too many terms/);
    expect(() => normalizeTerms("a".repeat(4097))).toThrow(/terms too long/);
  });

  it("terms array of 300 items → ToolInputError 'terms has too many items' before iterating (items are not even type-checked)", () => {
    const arr = Array.from({ length: 300 }, () => 12345); // 비문자 항목이지만 순회 전에 거부
    expect(() => normalizeTerms(arr)).toThrow(ToolInputError);
    expect(() => normalizeTerms(arr)).toThrow(/terms has too many items \(>256\)/);
    expect(() => normalizeTerms(arr)).not.toThrow(/items must be strings/);
    const edge = Array.from({ length: 256 }, () => "x");
    expect(() => normalizeTerms(edge)).toThrow(/too many terms/); // 가드 통과 → LIMITS.termsMax(10) 에서 걸림
    expect(() => normalizeTerms([...edge, "y"])).toThrow(/too many items/);
  });

  it("slugs: 5000-char string → 'slugs too long'; 300-item array → 'slugs has too many items'; slug: 5000 chars → 'slug too long (>4096'", () => {
    expect(() => normalizeSlugs("a,".repeat(2500))).toThrow(/slugs too long \(>4096 chars\)/);
    expect(() => normalizeSlugs(Array.from({ length: 300 }, () => "concept-reranking"))).toThrow(/slugs has too many items \(>256\)/);
    expect(() => normalizeSlugs(Array.from({ length: 300 }, () => null))).toThrow(/too many items/); // 순회 전 거부
    expect(() => normalizeSlug("a".repeat(5000))).toThrow(ToolInputError);
    expect(() => normalizeSlug("a".repeat(5000))).toThrow(/slug too long \(>4096 chars\)/);
    expect(() => normalizeSlug("a".repeat(4000))).toThrow(/slug too long \(>120\)/); // 가드 통과 후 LIMITS.slugLen
    expect(() => normalizeSlug(12345)).toThrow(/slug must be a string/); // 타입 검사가 가드보다 앞
  });

  it("via callTool: oversized raw inputs come back as isError one-liners, never a thrown protocol error", async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["wiki_search", { terms: "a ".repeat(2500) }, /terms too long/],
      ["wiki_expand", { terms: Array.from({ length: 300 }, () => "x") }, /too many items/],
      ["wiki_pack", { slugs: "a,".repeat(2500) }, /slugs too long/],
      ["wiki_pack", { slugs: Array.from({ length: 300 }, () => "x") }, /too many items/],
      ["wiki_read_page", { slug: "a".repeat(5000) }, /slug too long/],
    ];
    for (const [name, args, re] of cases) {
      const r = await callTool(FIXTURE_VAULT, name, args, undefined, true);
      expect(r.isError, name).toBe(true);
      expect(text(r), name).toMatch(re);
      expect(text(r), name).not.toContain("\n");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("codex r2 #3: vault scale limits — MAX_DIRS / MAX_DEPTH / MAX_TOTAL_BYTES → VaultLimitError", () => {
  it("constants are exported: MAX_DIRS 5000, MAX_DEPTH 32, MAX_TOTAL_BYTES 512 MiB (MAX_FILES 20000 unchanged)", () => {
    expect(MAX_DIRS).toBe(5000);
    expect(MAX_DEPTH).toBe(32);
    expect(MAX_TOTAL_BYTES).toBe(512 * 1024 * 1024);
    expect(MAX_FILES).toBe(20000);
  });

  it("a vault nested 33 directories deep → walkMd throws VaultLimitError (depth); 32 deep is accepted; callTool reports isError", async () => {
    const root = await tmp("llmwiki-r2-depth-");
    const wiki = path.join(root, "wiki");
    const deep33 = path.join(wiki, ...Array.from({ length: 33 }, (_, i) => `d${i}`));
    await mkdir(deep33, { recursive: true });
    await writeFile(path.join(deep33, "leaf.md"), "---\ntype: fact\n---\n- claim:: deep\n", "utf8");
    await expect(walkMd(wiki)).rejects.toBeInstanceOf(VaultLimitError);
    await expect(walkMd(wiki)).rejects.toThrow(/depth exceeds 32/);
    const r = await callTool(root, "wiki_search", { terms: ["deep"] }, undefined, true);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/depth exceeds 32/);
    // 32 단계는 허용
    const root32 = await tmp("llmwiki-r2-depth32-");
    const wiki32 = path.join(root32, "wiki");
    const deep32 = path.join(wiki32, ...Array.from({ length: 32 }, (_, i) => `d${i}`));
    await mkdir(deep32, { recursive: true });
    await writeFile(path.join(deep32, "leaf.md"), "---\ntype: fact\n---\n- claim:: deep\n", "utf8");
    const files = await walkMd(wiki32);
    expect(files.map((f) => f.slug)).toEqual(["leaf"]);
  });

  it("a vault with 5000 subdirectories (5001 incl. wiki/) → VaultLimitError (directories); 4999 is accepted", async () => {
    const root = await tmp("llmwiki-r2-dirs-");
    const wiki = path.join(root, "wiki");
    await mkdir(wiki);
    const names = Array.from({ length: 5000 }, (_, i) => `s${String(i).padStart(4, "0")}`);
    for (let i = 0; i < names.length; i += 250) await Promise.all(names.slice(i, i + 250).map((n) => mkdir(path.join(wiki, n))));
    await expect(walkMd(wiki)).rejects.toBeInstanceOf(VaultLimitError);
    await expect(walkMd(wiki)).rejects.toThrow(/exceeds 5000 directories/);
    await rm(path.join(wiki, names[names.length - 1]), { recursive: true }); // 4999 + wiki = 5000 → 허용
    await expect(walkMd(wiki)).resolves.toEqual([]);
  }, 60_000);

  it("MAX_TOTAL_BYTES (512 MiB) is enforced in readAll — asserted via the constant only (a 512 MiB fixture is infeasible in unit tests)", () => {
    expect(MAX_TOTAL_BYTES).toBeGreaterThan(MAX_FILES * 16 * 1024); // 20,000 × 16 KB 평균 페이지는 통과하는 상한
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("codex r2 #6: cmdq — Windows cmd.exe quoting", () => {
  it("`C:\\a b` → double-quoted; `%PATH%` is only quoted (no %% — not an escape at the cmd prompt; CLI form refuses such roots); `\"` → `\\\"`; safe token unchanged", () => {
    expect(cmdq("C:\\a b")).toBe('"C:\\a b"');
    expect(cmdq("%PATH%")).toBe('"%PATH%"');
    expect(cmdq('a"b')).toBe('"a\\"b"');
    expect(cmdq("C:\\wiki")).toBe("C:\\wiki");
    expect(cmdq("LLMWIKI_ROOT=C:\\wiki")).toBe("LLMWIKI_ROOT=C:\\wiki");
    expect(cmdq("LLMWIKI_ROOT=C:\\wiki\\%PATH%")).toBe('"LLMWIKI_ROOT=C:\\wiki\\%PATH%"');
    expect(cmdq("C:\\wiki\\safe&whoami")).toBe('"C:\\wiki\\safe&whoami"');
    expect(cmdq("C:\\x\\!vault")).toBe('"C:\\x\\!vault"'); // `!` 는 인용만(지연 확장은 주석으로 경고)
    expect(cmdq("")).toBe('""');
    expect(cmdq("npx")).toBe("npx");
    expect(cmdq("-y")).toBe("-y");
    // 안전 집합에 `/` 가 없어 `/c` 는 인용된다(기능상 무해 — 호출 셸이 따옴표를 벗긴다). shq 와 달리 `/` 미포함은 의도가 아닐 수 있음.
    expect(cmdq("/c")).toBe("/c"); // 안전 집합에 `/` 포함(3차 정정)
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("agy r2 MINOR-4: `print-config` anywhere in argv wins over `--once`; parsePrintConfig never treats a value as a flag", () => {
  it.skipIf(!HAVE_DIST)("`print-config --client agy --root <x> --once`: print-config mode is chosen (no --once usage/search runs); the stray `--once` is rejected by the strict print-config parser (exit 2)", () => {
    const r = run(["print-config", "--client", "agy", "--root", FIXTURE_VAULT, "--once"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim()).toBe("unexpected argument: --once");
    expect(r.stderr).not.toMatch(/usage: llmwiki-mcp --once/); // --once 분기가 아니라 print-config 분기에서 처리됐다
    // `--once search rerank` 가 앞에 있어도 print-config 가 이긴다 — 검색은 절대 실행되지 않는다
    const r2 = run(["--once", "search", "rerank", "print-config", "--client", "agy", "--root", FIXTURE_VAULT]);
    expect(r2.status).toBe(2);
    expect(r2.stdout).toBe("");
    expect(r2.stdout).not.toContain("concept-reranking");
    expect(r2.stderr.trim()).toMatch(/^unexpected argument: (--once|search)$/);
    // 정상 print-config 는 어느 위치에서든 exit 0 (root 존재 검증 없음)
    const ok = run(["--client", "agy", "--root", "/nonexistent/v", "print-config"]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("agy mcp add llmwiki -- npx -y llmwiki-mcp --root /nonexistent/v\n");
  });

  it.skipIf(!HAVE_DIST)("`--root --windows`: '--windows' is consumed as the root VALUE (not a flag) — POSIX output with `--root --windows`, no cmd wrapping", () => {
    const r = run(["print-config", "--client", "agy", "--root", "--windows"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("agy mcp add llmwiki -- npx -y llmwiki-mcp --root --windows\n");
    expect(r.stdout).not.toContain("cmd");
    expect(r.stdout).not.toContain("LLMWIKI_ROOT=");
    // `--name --global`: '--global' 은 이름 값으로 소비된 뒤 SERVER_NAME_RE 에서 거부된다(플래그로 해석되지 않았다는 증거)
    const n = run(["print-config", "--client", "cursor", "--root", "/v", "--name", "--global"]);
    expect(n.status).toBe(2);
    expect(n.stdout).toBe("");
    expect(n.stderr).toMatch(/invalid server name/);
    expect(n.stderr).toContain('"--global"');
  });

  it.skipIf(!HAVE_DIST)("a valued option at the end of argv (`--root` with no value) → exit 2 'requires a value'; unknown flag → exit 2", () => {
    const r = run(["print-config", "--client", "agy", "--root"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/option --root requires a value/);
    const u = run(["print-config", "--client", "agy", "--root", "/v", "--bogus"]);
    expect(u.status).toBe(2);
    expect(u.stderr).toMatch(/unexpected argument: --bogus/);
    const c = run(["print-config", "--root", "/v"]);
    expect(c.status).toBe(2);
    expect(c.stderr).toMatch(/--client must be one of/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("codex r2 #8 / agy r2 MAJOR-3: validateSubset is strict on declared properties and skips explicit undefined", () => {
  it("extra property on an object that declares `properties` → '<path>.<key>: unexpected property'", () => {
    const sch: JsonSchema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    expect(validateSubset(sch, { a: "x" })).toEqual([]);
    expect(validateSubset(sch, { a: "x", zzz: 1 })).toEqual(["$.zzz: unexpected property"]);
    expect(validateSubset(sch, { a: 1, zzz: 1 })).toEqual(["$.a: expected string", "$.zzz: unexpected property"]);
  });

  it("explicit undefined on an optional property → no error (it vanishes in JSON); defined-but-wrong still fails", () => {
    const sch: JsonSchema = { type: "object", properties: { a: { type: "string" }, opt: { type: "integer" } }, required: ["a"] };
    expect(validateSubset(sch, { a: "x", opt: undefined })).toEqual([]);
    expect(validateSubset(sch, { a: "x", opt: 3 })).toEqual([]);
    expect(validateSubset(sch, { a: "x", opt: "3" })).toEqual(["$.opt: expected integer"]);
    expect(validateSubset(sch, { a: "x", unknown: undefined })).toEqual([]); // 미선언 키라도 undefined 면 직렬화에서 사라진다
  });

  it("nested: unexpected keys inside array items and nested objects are reported with their path", () => {
    const sch: JsonSchema = {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
        meta: { type: "object", properties: { n: { type: "integer" } } },
      },
      required: ["rows"],
    };
    expect(validateSubset(sch, { rows: [{ slug: "a" }], meta: { n: 1 } })).toEqual([]);
    expect(validateSubset(sch, { rows: [{ slug: "a", extra: true }], meta: { n: 1, m: 2 }, top: 0 })).toEqual(["$.rows[0].extra: unexpected property", "$.meta.m: unexpected property", "$.top: unexpected property"]);
  });

  it("an object schema WITHOUT `properties` stays permissive (e.g. free-form maps) — strictness is tied to declared properties", () => {
    expect(validateSubset({ type: "object" }, { anything: 1, goes: "here" })).toEqual([]);
    expect(validateSubset({ type: "object", required: ["k"] }, { k: 1, other: 2 })).toEqual([]);
  });

  it("no tool outputSchema carries additionalProperties (client compatibility) — strictness is internal only", () => {
    const walk = (s: JsonSchema): void => {
      expect(s.additionalProperties, JSON.stringify(s).slice(0, 60)).toBeUndefined();
      for (const p of Object.values((s.properties as Record<string, JsonSchema> | undefined) ?? {})) walk(p);
      if (s.items) walk(s.items as JsonSchema);
    };
    for (const t of TOOLS) {
      walk(t.inputSchema);
      walk(t.outputSchema);
    }
  });
});

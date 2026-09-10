/**
 * 코덱스 P1 리뷰 BLOCKER-2 반영 — 골든 테스트가 간접 실행하던 대응표 행에 **명시적** 단위 테스트를 둔다:
 *   #4 field · #9 lower · #12~#14 expand 규칙 · #15 scoreText · #17b 미매치 메시지 · #21 옵션 기본값.
 * 모든 기대값은 Python 3.12.2 로 실제 실행해 얻었다(각 단언 위 주석의 Python 식/명령, 2026-09-09).
 * expand 규칙은 미니 볼트(임시 디렉터리에 생성)에서 `scope-expand.py` 출력을 그대로 고정한다.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGraph } from "../../src/graph.js";
import { bm25Rank, scoreText } from "../../src/bm25.js";
import { expand, lexicalSeeds } from "../../src/expand.js";
import { renderNoSeed, renderSearch } from "../../src/format.js";
import { normalizeTerms } from "../../src/search.js";
import { ArgError, parseArgs, pyInt, runOnce } from "../../src/once.js";
import { field, pyLower } from "../../src/vault.js";

// ---------- 미니 볼트 (scratch mini_expected.py 와 동일 내용) ----------
let root = "";
async function w(rel: string, text: string): Promise<void> {
  const p = path.join(root, "wiki", rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text, "utf8");
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "llmwiki-mini-"));
  await w("L3/a-seed.md", "---\ntype: concept\n---\n# A\nalpha 본문. [[b-page]] [[big-moc]]\n");
  await w("L3/b-page.md", "---\ntype: concept\n---\n# B\n이웃 페이지(lexical 0). [[a-seed]]\n");
  await w("L3/c-neighbor.md", "---\ntype: concept\n---\n# C\nalpha 를 포함하는 1홉 이웃. [[a-seed]]\n");
  await w("L3/d-double.md", "---\ntype: concept\n---\n# D\nlexical 0 이지만 두 seed 가 참조.\n");
  await w("L3/e-seed2.md", "---\ntype: concept\n---\n# E\nalpha alpha 두 번째 seed. [[d-double]]\n");
  await w("L3/f-seed3.md", "---\ntype: concept\n---\n# F\nalpha [[d-double]]\n");
  for (let i = 1; i <= 8; i++) await w(`L3/m${i}-member.md`, `---\ntype: concept\n---\n# M${i}\nmoc 멤버 ${i} (lexical 0)\n`);
  let moc = "---\ntype: moc\n---\n# big\n";
  for (let i = 1; i <= 8; i++) moc += `- [[m${i}-member]]\n`;
  await w("moc/big-moc.md", moc + "- [[c-neighbor]]\n");
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("#4 field — Python re.search(rf'^{name}:\\s*(.+)$', fm, re.M).group(1).strip()", () => {
  // fm = "type:<U+3000>concept\naliases:\n  x\nconfidence: 0.9 tail\nnote: 앞 뒤\n"  (type 뒤는 U+3000 전각 공백 — 코드에서는 \u3000 이스케이프)
  const fm = "type:\u3000concept\naliases:\n  x\nconfidence: 0.9 tail\nnote: 앞 뒤\n";
  it("P1-53 #4 유니코드 공백(U+3000)은 Python \\s 에 포함 → 값만 남는다", () => {
    // python: field(fm,'type') -> 'concept'
    expect(field(fm, "type")).toBe("concept");
  });
  it("P1-53 #4 `\\s*` 가 개행을 넘어 다음 줄 값을 잡는다(Python 과 동일)", () => {
    // python: field(fm,'aliases') -> 'x'
    expect(field(fm, "aliases")).toBe("x");
  });
  it("P1-53 #4 값은 줄 끝까지(공백 포함) 후 strip", () => {
    // python: field(fm,'confidence') -> '0.9 tail' ; field(fm,'note') -> '앞 뒤'
    expect(field(fm, "confidence")).toBe("0.9 tail");
    expect(field(fm, "note")).toBe("앞 뒤");
  });
  it("P1-53 #4 없는 필드는 빈 문자열", () => {
    // python: field(fm,'status') -> ''
    expect(field(fm, "status")).toBe("");
  });
  it("P1-53 #4 값 안의 U+2028 은 Python `.` 이 매치(개행만 제외) — JS `.` 과 다름", () => {
    // python: re.search(r'^t:\s*(.+)$', 't: a\u2028b', re.M).group(1) -> 'a\u2028b'
    expect(field("t: a\u2028b", "t")).toBe("a\u2028b");
  });
});

describe("#9 pyLower — Python str.lower()", () => {
  it("P1-54 #9 비ASCII·Final_Sigma·İ·ǅ 모두 Python 3.12 결과와 동일", () => {
    // python: 'ÀÉÎ Straße İ 한글 ΣΑΣ ǅ'.lower() -> 'àéî straße i̇ 한글 σας ǆ'
    expect(pyLower("ÀÉÎ Straße İ 한글 ΣΑΣ ǅ")).toBe("àéî straße i\u0307 한글 σας ǆ");
  });
});

describe("#12~#14 expand — 미니 볼트에서 scope-expand.py 출력 고정", () => {
  it("P1-55 #12 seed refs 는 99 에서 다른 seed 의 이웃일 때 bump 로 증가(100·101), tier0 는 필터 우회", async () => {
    // python3 scope-expand.py expand alpha --root <mini>  (앞 4행)
    const G = await buildGraph(path.join(root, "wiki"));
    const tl = normalizeTerms(["alpha"]);
    const seeds = lexicalSeeds(G, tl, 6);
    // lexical_seeds: (-distinct,-total,slug) → e-seed2(total 2) 가 첫 seed, 그다음 a-seed, c-neighbor, f-seed3
    expect(seeds).toEqual(["e-seed2", "a-seed", "c-neighbor", "f-seed3"]);
    const rows = expand(G, tl, seeds, 15);
    expect(rows.slice(0, 4)).toEqual([
      { slug: "c-neighbor", tier: 0, refs: 101 }, // a-seed 의 out 이웃 + big-moc 멤버(kept2) → 99+1+1
      { slug: "a-seed", tier: 0, refs: 100 }, // c-neighbor 의 out 이웃 → 99+1
      { slug: "e-seed2", tier: 0, refs: 99 },
      { slug: "f-seed3", tier: 0, refs: 99 },
    ]);
  });
  it("P1-55 #14 tier1 필터: lex 0·refs 1 인 b-page 는 탈락, lex 0·refs 2 인 d-double 은 유지, big-moc 은 1hop", async () => {
    const G = await buildGraph(path.join(root, "wiki"));
    const tl = normalizeTerms(["alpha"]);
    const rows = expand(G, tl, lexicalSeeds(G, tl, 6), 15);
    const slugs = rows.map((r) => r.slug);
    expect(slugs).not.toContain("b-page");
    expect(rows.find((r) => r.slug === "d-double")).toEqual({ slug: "d-double", tier: 1, refs: 2 });
    expect(rows.find((r) => r.slug === "big-moc")).toEqual({ slug: "big-moc", tier: 1, refs: 2 });
  });
  it("P1-55 #13 이웃 MoC 멤버는 (-lex, slug) 순 상위 MEMBER_K=6 만 tier2(moc) — c-neighbor(lex1) + m1..m5, m6~m8 탈락", async () => {
    const G = await buildGraph(path.join(root, "wiki"));
    const tl = normalizeTerms(["alpha"]);
    const rows = expand(G, tl, lexicalSeeds(G, tl, 6), 15);
    const moc = rows.filter((r) => r.tier === 2).map((r) => r.slug);
    // python 출력 moc 행: m1-member … m5-member (c-neighbor 는 seed 라 tier0 유지)
    expect(moc).toEqual(["m1-member", "m2-member", "m3-member", "m4-member", "m5-member"]);
    expect(rows.map((r) => r.slug)).not.toContain("m6-member");
    expect(rows).toHaveLength(11);
  });
  it("P1-55 #14 최종 정렬 (tier, -lex, -refs, slug) 후 [:max] — 전체 텍스트가 Python stdout 과 동일", async () => {
    // python3 scope-expand.py expand alpha --root <mini>
    const want =
      "seed\t101\tc-neighbor\tconcept\nseed\t100\ta-seed\tconcept\nseed\t99\te-seed2\tconcept\nseed\t99\tf-seed3\tconcept\n" +
      "1hop\t2\tbig-moc\tmoc\n1hop\t2\td-double\tconcept\n" +
      "moc\t1\tm1-member\tconcept\nmoc\t1\tm2-member\tconcept\nmoc\t1\tm3-member\tconcept\nmoc\t1\tm4-member\tconcept\nmoc\t1\tm5-member\tconcept\n";
    expect(await runOnce("expand", ["alpha", "--root", root])).toBe(want);
    // --max 3 → 앞 3행만
    expect(await runOnce("expand", ["alpha", "--root", root, "--max", "3"])).toBe(
      "seed\t101\tc-neighbor\tconcept\nseed\t100\ta-seed\tconcept\nseed\t99\te-seed2\tconcept\n",
    );
    // --top-seed 1 → seed 는 e-seed2 하나, 이웃 d-double 은 lex0·refs1 로 탈락 → 1행
    expect(await runOnce("expand", ["alpha", "--root", root, "--top-seed", "1"])).toBe("seed\t99\te-seed2\tconcept\n");
  });
  it("P1-55 #16/#17 --rerank 2 → BM25 상위 2행, 점수 .1f", async () => {
    // python3 scope-expand.py expand alpha --root <mini> --rerank 2
    expect(await runOnce("expand", ["alpha", "--root", root, "--rerank", "2"])).toBe("seed\t1.8\te-seed2\tconcept\nseed\t1.4\tf-seed3\tconcept\n");
  });
});

describe("#15 scoreText — Python _score_text", () => {
  it("P1-56 #15 마크다운 링크 타겟 제거·URL 제거(Python \\S 는 U+001C 에서 멈춤)·소문자", async () => {
    // python: t='See [문서](http://x.y/z) and https://a.b/c\x1cREST plain https://q.r after HTTPS://UP.per/x'
    //         t=re.sub(r'\]\([^)]*\)',']',t); t=re.sub(r'https?://\S+','',t); t.lower()
    //      -> 'see [문서] and \x1crest plain  after https://up.per/x'
    const G = await buildGraph(path.join(root, "wiki"));
    const node = { ...(G.nodes.get("a-seed") as NonNullable<ReturnType<typeof G.nodes.get>>) };
    node.text = "See [문서](http://x.y/z) and https://a.b/c\x1cREST plain https://q.r after HTTPS://UP.per/x";
    node.aliases = "";
    expect(scoreText(node)).toBe("see [문서] and \x1crest plain  after https://up.per/x\n");
    // bm25Rank 는 terms 중복 제거·길이<2 제외: ['a','alpha','alpha'] → ['alpha']
    const { ranked } = bm25Rank(G, ["a", "alpha", "alpha"], ["e-seed2", "f-seed3"]);
    expect(ranked).toEqual(["e-seed2", "f-seed3"]);
  });
});

describe("#17b 미매치 메시지 — search 는 소문자화, expand 는 원본 유지", () => {
  it("P1-57 #17b search: `no matches for: nosuch term`", async () => {
    // python3 search.py --files NoSuch Term --root <mini> -> 'no matches for: nosuch term\n'
    expect(renderSearch(normalizeTerms(["NoSuch", "Term"]), [], 0)).toBe("no matches for: nosuch term\n");
    expect(await runOnce("search", ["NoSuch", "Term", "--root", root])).toBe("no matches for: nosuch term\n");
  });
  it("P1-57 #17b expand: `no lexical seed for: NoSuch Term`(대소문자·공백 term 그대로)", async () => {
    // python3 scope-expand.py expand NoSuch Term --root <mini> -> 'no lexical seed for: NoSuch Term\n'
    expect(renderNoSeed(["NoSuch", "Term"])).toBe("no lexical seed for: NoSuch Term\n");
    expect(await runOnce("expand", ["NoSuch", "Term", "--root", root])).toBe("no lexical seed for: NoSuch Term\n");
    // python: ' '.join(['', 'X']) -> ' X'
    expect(renderNoSeed(["", "X"])).toBe("no lexical seed for:  X\n");
  });
});

describe("#21 옵션 기본값·파싱 — Python main(): top 8 / top-seed 6 / max 15 / rerank 0", () => {
  it("P1-58 #21 search --top 기본 8 → 8행(m6 포함, m7·m8 잘림)", async () => {
    // python3 search.py --files moc --root <mini>
    const want =
      "1/1\ta-seed\tconcept\n1/1\tbig-moc\tmoc\n1/1\tm1-member\tconcept\n1/1\tm2-member\tconcept\n" +
      "1/1\tm3-member\tconcept\n1/1\tm4-member\tconcept\n1/1\tm5-member\tconcept\n1/1\tm6-member\tconcept\n";
    expect(await runOnce("search", ["moc", "--root", root])).toBe(want);
    expect(await runOnce("search", ["moc", "--root", root, "--top", "8"])).toBe(want);
  });
  it("P1-58 #21 expand 기본값 6/15/0 과 명시값이 동일 출력", async () => {
    const a = await runOnce("expand", ["alpha", "--root", root]);
    const b = await runOnce("expand", ["alpha", "--root", root, "--top-seed", "6", "--max", "15", "--rerank", "0"]);
    expect(a).toBe(b);
  });
  it("P1-58 #21 parseArgs: 알려진 옵션은 값 1개 소비, 나머지는 위치 인자, `--files` 무시", () => {
    const { opts, positional } = parseArgs(["a", "--files", "--root", "R", "b", "--max", "3"], { "--root": "root", "--max": "max" });
    expect(opts).toEqual({ root: "R", max: "3" });
    expect(positional).toEqual(["a", "b"]);
  });
  it("P1-58 #21 Python int() 의미: 정수만 허용(`1.5` 거부, 공백·부호·밑줄 허용), 값 없는 옵션은 오류", () => {
    // python: int('1.5') -> ValueError ; int(' 7 ') -> 7 ; int('+3') -> 3 ; int('1_0') -> 10
    expect(pyInt(" 7 ", "top")).toBe(7);
    expect(pyInt("+3", "top")).toBe(3);
    expect(pyInt("1_0", "top")).toBe(10);
    expect(() => pyInt("1.5", "top")).toThrow(ArgError);
    expect(() => pyInt("abc", "top")).toThrow(ArgError);
    expect(() => parseArgs(["--root"], { "--root": "root" })).toThrow(ArgError);
  });
});

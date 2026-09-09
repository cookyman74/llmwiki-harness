/**
 * 3차 외부리뷰 MAJOR-5 — "라우팅 힌트가 structuredContent 에만 있어, structuredContent 를 못 읽는 클라이언트는 다음 도구를 모른다".
 *
 * 수정 후 계약:
 *  - **MCP `wiki_expand` 응답 텍스트**는 리트리벌 텍스트 뒤에 `suggested_next: <wiki_pack|wiki_read_page|answer>` 한 줄을 더 싣는다.
 *    라우팅은 suggestedNext(max, rerank) 그대로 — rerank>0 → wiki_pack, max≤6 → answer, 그 밖 → wiki_read_page.
 *  - **`--once` 출력은 바뀌지 않는다** — Python 정본과의 바이트 패리티 대상이므로 힌트가 새어 들어가면 안 된다.
 *    실제 `node dist/cli.js --once expand …` 를 띄워 Python 골든(test/fixtures/expected/q01-expand.txt)과 바이트 비교한다
 *    (dist 가 없으면 사유를 남기고 skip — `npm run build` 후 검사).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOnce } from "../../src/once.js";
import { suggestedNext } from "../../src/tools.js";
import { DIST_CLI, FIXTURES, FIXTURE_VAULT, connect, text, type Connected } from "./p2-helpers.js";

const HAVE_DIST = existsSync(DIST_CLI);
const V = FIXTURE_VAULT;

let c: Connected;
beforeAll(async () => {
  c = await connect(V);
});
afterAll(async () => c.close());

const ROUTES: { case: string; args: Record<string, unknown>; want: "wiki_pack" | "wiki_read_page" | "answer" }[] = [
  { case: "rerank>0 → 사실 브리핑은 팩으로", args: { terms: ["rerank"], max: 20, rerank: 11 }, want: "wiki_pack" },
  { case: "max≤6 → 단일 조회는 시드만으로 답한다", args: { terms: ["rerank"], max: 6 }, want: "answer" },
  { case: "그 밖 → 절차는 전문을 읽는다", args: { terms: ["rerank"], max: 15 }, want: "wiki_read_page" },
  { case: "시드 미매치에도 힌트는 붙는다", args: { terms: ["ZZZNOPE"], max: 15 }, want: "wiki_read_page" },
];

describe("3차 MAJOR-5: wiki_expand MCP 텍스트에 suggested_next 힌트", () => {
  for (const r of ROUTES) {
    it(`MCP 텍스트 마지막 줄이 suggested_next: ${r.want} — ${r.case}`, async () => {
      const res = await c.call("wiki_expand", r.args);
      expect(res.isError, text(res)).toBeFalsy();
      const sc = res.structuredContent as Record<string, unknown>;
      expect(sc.suggested_next).toBe(r.want);
      expect(text(res)).toBe(sc.text); // 텍스트가 1차 표현
      const lines = text(res).split("\n");
      expect(lines[lines.length - 1]).toBe(""); // 개행으로 끝난다
      expect(lines[lines.length - 2]).toBe(`suggested_next: ${r.want}`);
      // 힌트는 정확히 한 줄만 — 리트리벌 텍스트에는 없다
      expect(lines.filter((ln) => ln.startsWith("suggested_next:"))).toHaveLength(1);
    });
  }

  it("힌트 줄을 빼면 --once 텍스트와 바이트 동일 — 힌트가 유일한 차이", async () => {
    for (const r of ROUTES) {
      const max = r.args.max as number;
      const rerank = (r.args.rerank as number | undefined) ?? 0;
      const terms = r.args.terms as string[];
      const argv = [...terms, "--root", V, "--top-seed", "6", "--max", String(max), ...(rerank ? ["--rerank", String(rerank)] : [])];
      const once = await runOnce("expand", argv);
      expect(once).not.toContain("suggested_next"); // 리트리벌 텍스트는 순수 표
      const res = await c.call("wiki_expand", { ...r.args, top_seed: 6 });
      expect(text(res)).toBe(`${once}suggested_next: ${suggestedNext(max, rerank)}\n`);
    }
  });

  it("search / pack / read_page 텍스트에는 힌트가 없다 — expand 전용", async () => {
    const s = await c.call("wiki_search", { terms: ["rerank"], top: 8 });
    const p = await c.call("wiki_pack", { slugs: ["concept-reranking"] });
    const rp = await c.call("wiki_read_page", { slug: "concept-reranking" });
    for (const res of [s, p, rp]) expect(text(res)).not.toContain("suggested_next");
    // 그리고 이 셋은 --once 와 완전히 동일하다(패리티 유지)
    expect(text(s)).toBe(await runOnce("search", ["--files", "rerank", "--root", V, "--top", "8"]));
    expect(text(p)).toBe(await runOnce("pack", ["concept-reranking", "--root", V]));
  });

  it.skipIf(!HAVE_DIST)("`node dist/cli.js --once expand` stdout 은 Python 골든과 바이트 동일 — 힌트 없음", () => {
    const golden = readFileSync(path.join(FIXTURES, "expected", "q01-expand.txt"), "utf8");
    const env = { ...process.env };
    delete env.LLMWIKI_ROOT;
    delete env.LLMWIKI_DEBUG;
    // gen-expected.py 의 expand 인자와 동일(queries.json defaults: top_seed 6, max 15)
    const r = spawnSync(process.execPath, [DIST_CLI, "--once", "expand", "벡터", "인덱스", "--root", V, "--top-seed", "6", "--max", "15"], {
      encoding: "utf8",
      env,
      timeout: 30_000,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("suggested_next");
    expect(r.stdout).toBe(golden);
  });

  it("힌트 유무와 무관하게 structuredContent.suggested_next 는 suggestedNext() 표와 일치", () => {
    expect(suggestedNext(20, 11)).toBe("wiki_pack");
    expect(suggestedNext(6, 0)).toBe("answer");
    expect(suggestedNext(1, 0)).toBe("answer");
    expect(suggestedNext(7, 0)).toBe("wiki_read_page");
    expect(suggestedNext(6, 11)).toBe("wiki_pack"); // rerank 가 우선
  });
});

if (!HAVE_DIST) {
  // eslint-disable-next-line no-console
  console.error(`SKIP: ${DIST_CLI} not found — run \`npm run build\` first`);
}

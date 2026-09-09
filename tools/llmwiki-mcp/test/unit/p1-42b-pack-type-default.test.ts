// P1-42b — 대응표 #5: `type` 기본값 비대칭 — build_graph(expand)·search.py 는 **부모 디렉터리명**, do_pack 헤더는 **`?`**.
// 커밋된 픽스처 test/fixtures/vault, slug 'procedure-no-type' (frontmatter 에 type 없음, wiki/L4-procedural/ 아래).
// python3 확인 (2026-09-09) — 픽스처 expected 파일과 동일:
//   scope-expand.py pack procedure-no-type --root <fixture>  -> "## procedure-no-type  [? · conf - · active]\n- frontmatter에 type이 없으면 …\n\n"
//   search.py --files 절차 --root <fixture>                  -> "1/2\tprocedure-deploy-index\tprocedure\n1/2\tprocedure-no-type\tL4-procedural\n"
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../src/graph.js";
import { renderPack } from "../../src/format.js";
import { pack } from "../../src/pack.js";
import { filesMode } from "../../src/search.js";
import { runOnce } from "../../src/once.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.join(HERE, "..", "fixtures", "vault");
const SLUG = "procedure-no-type";

describe("P1-42b #5 type default asymmetry (pack '?' vs graph/search dirname)", () => {
  it("P1-42b #5 fixture sanity: procedure-no-type.md has no `type:` in its frontmatter", async () => {
    const text = await fs.readFile(path.join(VAULT, "wiki", "L4-procedural", `${SLUG}.md`), "utf8");
    expect(/^type:/m.test(text)).toBe(false);
  });

  it("P1-42b #5 pack header uses '?' when type is missing", async () => {
    const pages = await pack([SLUG], VAULT);
    expect(pages[0].found).toBe(true);
    expect(pages[0].type).toBe("?");
    expect(renderPack(pages).startsWith(`## ${SLUG}  [? · conf - · active]\n`)).toBe(true);
    expect(await runOnce("pack", [SLUG, "--root", VAULT])).toBe(
      `## ${SLUG}  [? · conf - · active]\n- frontmatter에 type이 없으면 부모 디렉터리명(L4-procedural)이 type이 된다.\n\n`,
    );
  });

  it("P1-42b #5 filesMode row.type === 'L4-procedural' (parent directory name)", async () => {
    const { rows } = await filesMode(["절차"], VAULT, 8);
    const row = rows.find((r) => r.slug === SLUG);
    expect(row?.type).toBe("L4-procedural");
    expect(await runOnce("search", ["--files", "절차", "--root", VAULT, "--top", "8"])).toBe(
      "1/2\tprocedure-deploy-index\tprocedure\n1/2\tprocedure-no-type\tL4-procedural\n",
    );
  });

  it("P1-42b #5 buildGraph node.type === 'L4-procedural' (parent directory name)", async () => {
    const G = await buildGraph(path.join(VAULT, "wiki"));
    expect(G.nodes.get(SLUG)?.type).toBe("L4-procedural");
  });

  it("P1-42b #5 pack of a missing slug renders '(없음)' with type '?' placeholder fields", async () => {
    const pages = await pack(["nonexistent-slug"], VAULT);
    expect(pages[0]).toEqual({ slug: "nonexistent-slug", found: false, type: "?", confidence: "-", status: "active", claims: [], summary: "", relations: [] });
    expect(renderPack(pages)).toBe("## nonexistent-slug\n(없음)\n\n");
  });
});

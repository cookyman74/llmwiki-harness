// P1-41 — 대응표 #1 (+#5): 중복 slug — graph/pack 은 dict 대입 → walk 순서 **마지막 승**(L3-semantic 가 L2-episodic 뒤).
// search.py --files 는 파일 단위 순회라 **두 행**을 낸다. 이 비대칭은 Python 정본의 것이다.
// python3 확인 (2026-09-09) — 임시 볼트 wiki/L2-episodic/dup.md (type: episodic, claim 'L2 claim')
//                                       wiki/L3-semantic/dup.md (type: fact, confidence 0.95, claim 'L3 claim', '- uses :: [[other]]'):
//   build_graph(...) keys -> ['dup'];  G['dup']['type'] -> 'fact';  text is the L3 file
//   scope-expand.py pack dup      ->  "## dup  [fact · conf 0.95 · active]\n- L3 claim\n- 관계) uses :: [[other]]\n\n"
//   search.py --files claim       ->  "1/2\tdup\tepisodic\n1/2\tdup\tfact\n"
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGraph } from "../../src/graph.js";
import { renderPack, renderSearch } from "../../src/format.js";
import { pack } from "../../src/pack.js";
import { filesMode } from "../../src/search.js";
import { runOnce } from "../../src/once.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "llmwiki-p1-41-"));
  const l2 = path.join(root, "wiki", "L2-episodic");
  const l3 = path.join(root, "wiki", "L3-semantic");
  await fs.mkdir(l2, { recursive: true });
  await fs.mkdir(l3, { recursive: true });
  await fs.writeFile(path.join(l2, "dup.md"), "---\ntype: episodic\nconfidence: 0.6\n---\n- claim:: L2 claim\n");
  await fs.writeFile(path.join(l3, "dup.md"), "---\ntype: fact\nconfidence: 0.95\nstatus: active\n---\n- claim:: L3 claim\n- uses :: [[other]]\n");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("P1-41 #1 duplicate slug: graph/pack last-wins vs search two rows", () => {
  it("P1-41 #1 buildGraph: nodes has ONE 'dup' whose text/type come from the L3 file (last in walk order)", async () => {
    const G = await buildGraph(path.join(root, "wiki"));
    expect([...G.nodes.keys()]).toEqual(["dup"]);
    const n = G.nodes.get("dup");
    expect(n?.type).toBe("fact");
    expect(n?.text).toBe("---\ntype: fact\nconfidence: 0.95\nstatus: active\n---\n- claim:: L3 claim\n- uses :: [[other]]\n");
    expect(n?.text.includes("L2 claim")).toBe(false);
  });

  it("P1-41 #1 pack(['dup']): header and claims come from the L3 page", async () => {
    const pages = await pack(["dup"], root);
    expect(pages).toHaveLength(1);
    expect(pages[0].found).toBe(true);
    expect(pages[0].type).toBe("fact");
    expect(pages[0].confidence).toBe("0.95");
    expect(pages[0].claims).toEqual(["L3 claim"]);
    expect(pages[0].relations).toEqual(["uses :: [[other]]"]);
    expect(renderPack(pages)).toBe("## dup  [fact · conf 0.95 · active]\n- L3 claim\n- 관계) uses :: [[other]]\n\n");
    expect(await runOnce("pack", ["dup", "--root", root])).toBe("## dup  [fact · conf 0.95 · active]\n- L3 claim\n- 관계) uses :: [[other]]\n\n");
  });

  it("P1-41 #1 filesMode('claim'): returns TWO rows for slug 'dup' (files, not graph) — episodic first by walk/sort", async () => {
    const { rows, terms } = await filesMode(["claim"], root, 8);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.slug)).toEqual(["dup", "dup"]);
    // both score 1/2 ('claim' in 'claim::' and in 'L2 claim'/'L3 claim') → full tie → stable sort keeps walk order (L2 then L3)
    expect(rows.map((r) => `${r.distinct}/${r.total}`)).toEqual(["1/2", "1/2"]);
    expect(rows.map((r) => r.type)).toEqual(["episodic", "fact"]);
    expect(renderSearch(terms, rows)).toBe("1/2\tdup\tepisodic\n1/2\tdup\tfact\n");
    expect(await runOnce("search", ["--files", "claim", "--root", root])).toBe("1/2\tdup\tepisodic\n1/2\tdup\tfact\n");
  });
});

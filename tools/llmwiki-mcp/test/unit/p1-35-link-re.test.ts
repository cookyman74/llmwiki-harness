// P1-35 — 대응표 #7: `LINK = re.compile(r"(?<!!)\[\[([^\]|#]+)")` — `![[…]]` 임베드 제외, `|`·`#` 앞까지가 타겟.
// python3 확인 (2026-09-09):
//   LINK.findall("![[img.png]] [[page]]") -> ['page']
//   LINK.findall("[[a|b]]")               -> ['a']
//   LINK.findall("[[a#h]]")               -> ['a']
//   LINK.findall("[[ spaced ]]")          -> [' spaced ']   (regex keeps spaces; build_graph strips)
//   LINK.findall("[[a]] [[b]]")           -> ['a', 'b']
//   LINK.findall("x![[e]]")               -> []
//   LINK.findall("[[a\nb]]")              -> ['a\nb']       ([^\]|#] crosses newlines)
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINK_RE, buildGraph } from "../../src/graph.js";

function findall(s: string): string[] {
  return [...s.matchAll(LINK_RE)].map((m) => m[1]);
}

describe("P1-35 #7 LINK_RE", () => {
  it("P1-35 #7 LINK_RE: '![[img.png]] [[page]]' → ['page'] (embed excluded by (?<!!))", () => {
    expect(findall("![[img.png]] [[page]]")).toEqual(["page"]);
  });

  it("P1-35 #7 LINK_RE: '[[a|b]]' → ['a'] (display alias cut at |)", () => {
    expect(findall("[[a|b]]")).toEqual(["a"]);
  });

  it("P1-35 #7 LINK_RE: '[[a#h]]' → ['a'] (heading anchor cut at #)", () => {
    expect(findall("[[a#h]]")).toEqual(["a"]);
  });

  it("P1-35 #7 LINK_RE: '[[ spaced ]]' group is ' spaced ' (regex does not strip)", () => {
    expect(findall("[[ spaced ]]")).toEqual([" spaced "]);
  });

  it("P1-35 #7 LINK_RE: multiple links and embed-only text", () => {
    expect(findall("[[a]] [[b]]")).toEqual(["a", "b"]);
    expect(findall("x![[e]]")).toEqual([]);
    expect(findall("[[a\nb]]")).toEqual(["a\nb"]); // python [^\]|#] matches newline too
  });

  it("P1-35 #7/#8 buildGraph normalizes '[[ spaced ]]' to slug 'spaced' (m.strip()) and drops embeds", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmwiki-p1-35-"));
    try {
      const w = path.join(dir, "wiki", "L3-semantic");
      await fs.mkdir(w, { recursive: true });
      await fs.writeFile(path.join(w, "src.md"), "---\ntype: fact\n---\n[[ spaced ]] ![[spaced]] [[spaced|shown]] [[spaced#sec]] [[missing]]\n");
      await fs.writeFile(path.join(w, "spaced.md"), "---\ntype: concept\n---\nself [[spaced]] link is dropped\n");
      const G = await buildGraph(path.join(dir, "wiki"));
      expect([...(G.nodes.get("src")?.out ?? [])]).toEqual(["spaced"]); // 'missing' not in G → dropped
      expect([...(G.nodes.get("spaced")?.in ?? [])]).toEqual(["src"]);
      expect(G.nodes.get("spaced")?.out.size).toBe(0); // self-link excluded (tgt != s)
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

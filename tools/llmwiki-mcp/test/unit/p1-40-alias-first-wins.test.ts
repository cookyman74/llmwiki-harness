// P1-40 — 대응표 #8 (+#1): alias 등록은 `alias2slug.setdefault(a.lower(), slug)` → walk 순서상 **먼저** 등록한 페이지가 이김.
// slug 키는 대입(`alias2slug[slug.lower()] = slug`) → 마지막 승이지만 slug 는 파일마다 고유하므로 자기 자신을 가리킨다.
// python3 확인 (2026-09-09) — 아래와 같은 임시 볼트에서 scope-expand.walk_md / build_graph 를 실행:
//   wiki/L2-episodic/zzz-late.md   aliases: [dup-alias, only-zzz]
//   wiki/L3-semantic/aaa-early.md  aliases: [Dup-Alias, only-aaa]
//   wiki/L3-semantic/bbb-mid.md    aliases: [dup-alias]
//   walk order -> ['zzz-late', 'aaa-early', 'bbb-mid']        (dirs sorted: L2-episodic before L3-semantic)
//   alias2slug -> {'zzz-late': 'zzz-late', 'dup-alias': 'zzz-late', 'only-zzz': 'zzz-late',
//                  'aaa-early': 'aaa-early', 'only-aaa': 'aaa-early', 'bbb-mid': 'bbb-mid'}
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGraph, type Graph } from "../../src/graph.js";
import { pyLower, walkMd } from "../../src/vault.js";

let dir: string;
let G: Graph;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmwiki-p1-40-"));
  const l2 = path.join(dir, "wiki", "L2-episodic");
  const l3 = path.join(dir, "wiki", "L3-semantic");
  await fs.mkdir(l2, { recursive: true });
  await fs.mkdir(l3, { recursive: true });
  await fs.writeFile(path.join(l2, "zzz-late.md"), "---\ntype: fact\naliases: [dup-alias, only-zzz]\n---\nzzz body\n");
  await fs.writeFile(path.join(l3, "aaa-early.md"), "---\ntype: concept\naliases: [Dup-Alias, only-aaa]\n---\naaa body\n");
  await fs.writeFile(path.join(l3, "bbb-mid.md"), "---\ntype: concept\naliases: [dup-alias]\n---\nbbb body\n");
  G = await buildGraph(path.join(dir, "wiki"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("P1-40 #8 alias2slug first-registration wins", () => {
  it("P1-40 #1 walkMd order: directories sorted → L2-episodic file visited before L3-semantic files", async () => {
    const order = (await walkMd(path.join(dir, "wiki"))).map((f) => f.slug);
    expect(order).toEqual(["zzz-late", "aaa-early", "bbb-mid"]);
  });

  it("P1-40 #8 alias2slug.get('dup-alias') is the FIRST page in walk order (zzz-late), not the alphabetically first", () => {
    expect(G.alias2slug.get("dup-alias")).toBe("zzz-late");
    expect(G.alias2slug.get("dup-alias")).not.toBe("aaa-early");
  });

  it("P1-40 #8 alias keys are lower-cased ('Dup-Alias' → 'dup-alias') and unique aliases map to their own page", () => {
    expect(G.alias2slug.has("Dup-Alias")).toBe(false);
    expect(G.alias2slug.get("only-zzz")).toBe("zzz-late");
    expect(G.alias2slug.get("only-aaa")).toBe("aaa-early");
  });

  it("P1-40 #8 slug keys: alias2slug.get(lower(slug)) === slug for every node (assignment, self-referencing)", () => {
    for (const slug of G.nodes.keys()) expect(G.alias2slug.get(pyLower(slug))).toBe(slug);
    expect(G.alias2slug.size).toBe(6); // 3 slugs + dup-alias + only-zzz + only-aaa
  });

  it("P1-40 #8 links via the duplicated alias resolve to the first registrant", async () => {
    const l3 = path.join(dir, "wiki", "L3-semantic");
    await fs.writeFile(path.join(l3, "linker.md"), "---\ntype: fact\n---\nsee [[dup-alias]] and [[Only-AAA]]\n");
    const G2 = await buildGraph(path.join(dir, "wiki"));
    expect([...(G2.nodes.get("linker")?.out ?? [])].sort()).toEqual(["aaa-early", "zzz-late"]);
    expect(G2.nodes.get("zzz-late")?.in.has("linker")).toBe(true);
    expect(G2.nodes.get("bbb-mid")?.in.size).toBe(0);
  });
});

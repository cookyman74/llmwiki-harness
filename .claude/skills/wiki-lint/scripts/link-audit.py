#!/usr/bin/env python3
"""Link audit for the LLM wiki (deterministic, 0 LLM tokens).

Scans wiki/ markdown pages, resolves [[wikilinks]], and reports:
  - broken   : wikilinks whose target page does not exist
  - orphans  : pages with zero inbound wikilinks (candidates; MoC reachability
               is judged separately by the linter)

Obsidian wikilinks are name-based, so a link [[foo]] matches a file named
foo.md anywhere under the vault. Links may carry an alias ([[foo|별칭]]) or a
heading (#) or block (^) anchor — all stripped before matching.

Usage:
  python3 link-audit.py [vault_root]   # default: current dir
  python3 link-audit.py --json         # machine-readable
"""
import os
import re
import sys
import json

WIKILINK = re.compile(r"\[\[([^\]]+?)\]\]")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
FENCE = re.compile(r"```.*?```", re.DOTALL)


def strip_target(raw):
    # [[target|alias]] -> target ; drop #heading / ^block anchors.
    # Obsidian table cells escape the alias pipe as [[target\|alias]]; strip the
    # trailing backslash so the escaped form isn't mis-parsed as a broken link.
    t = raw.split("|", 1)[0].rstrip("\\")
    t = t.split("#", 1)[0].split("^", 1)[0]
    return t.strip()


def slug(path):
    return os.path.splitext(os.path.basename(path))[0]


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    as_json = "--json" in sys.argv[1:]
    root = args[0] if args else "."

    # Candidate .md: wiki/ (recursive) + root-level (index.md, log.md). A file is a
    # wiki PAGE only if its frontmatter declares `type:` — this excludes CLAUDE.md
    # (the schema, not a page) and any stray markdown.
    candidates = []
    for dp, _, files in os.walk(os.path.join(root, "wiki")):
        candidates += [os.path.relpath(os.path.join(dp, f), root) for f in files if f.endswith(".md")]
    candidates += [f for f in os.listdir(root)
                   if f.endswith(".md") and os.path.isfile(os.path.join(root, f))]

    # Entry points and record-types legitimately have 0 inbound wikilinks
    # (index/log are hubs; working/episodic/session/source are leaf records).
    # Real orphans are semantic/entity/concept/procedure/moc pages with no inbound.
    HUB_TYPES = {"index", "log", "working", "episodic", "session", "source"}
    pages = {}       # slug -> relpath (type-declaring pages only)
    hub_slugs = set()
    for rel in candidates:
        with open(os.path.join(root, rel), encoding="utf-8") as fh:
            head = fh.read(400)
        m = re.search(r"^type:\s*(\w+)", head, re.MULTILINE)
        if not m:
            continue  # not a wiki page (e.g. CLAUDE.md)
        pages.setdefault(slug(rel), rel)
        if m.group(1) in HUB_TYPES:
            hub_slugs.add(slug(rel))

    inbound = {s: 0 for s in pages}
    broken = []  # (source_page, target)
    for s, rel in pages.items():
        with open(os.path.join(root, rel), encoding="utf-8") as fh:
            text = fh.read()
        # ignore links inside HTML comments (examples) and code fences
        text = HTML_COMMENT.sub("", text)
        text = FENCE.sub("", text)
        for m in WIKILINK.finditer(text):
            tgt = strip_target(m.group(1))
            if not tgt:
                continue
            if tgt in pages:
                if tgt != s:
                    inbound[tgt] += 1
            else:
                broken.append({"page": rel, "target": tgt})

    orphans = sorted(pages[s] for s, n in inbound.items() if n == 0 and s not in hub_slugs)

    # Dedupe (page, target) — a page may link the same missing target many times.
    uniq = sorted({(b["page"], b["target"]) for b in broken})
    broken_u = [{"page": p, "target": t} for p, t in uniq]

    # Aggregate missing targets by how many distinct pages reference them.
    # A target referenced by many pages is a strong "write this page next" signal
    # (the lint skill's 누락 개념 candidate) rather than a typo.
    from collections import defaultdict
    refs = defaultdict(set)
    for p, t in uniq:
        refs[t].add(p)
    stub_targets = sorted(
        ({"target": t, "referenced_by": len(ps),
          "pages": sorted(ps)} for t, ps in refs.items()),
        key=lambda x: (-x["referenced_by"], x["target"]))

    result = {
        "page_count": len(pages),
        "broken_count": len(broken_u),
        "orphan_count": len(orphans),
        "stub_target_count": len(stub_targets),
        "broken": broken_u,
        "orphans": orphans,
        "stub_targets": stub_targets,
    }

    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"pages: {result['page_count']}  broken(uniq): {result['broken_count']}  "
          f"orphans: {result['orphan_count']}  stub-targets: {result['stub_target_count']}")
    if stub_targets:
        print("\n== missing targets (작성 후보 — inbound 많을수록 우선) ==")
        for st in stub_targets:
            print(f"  [[{st['target']}]]  <- {st['referenced_by']} page(s): {', '.join(st['pages'])}")
    if orphans:
        print("\n== orphan pages (0 inbound wikilinks) ==")
        for o in orphans:
            print(f"  {o}")


if __name__ == "__main__":
    main()

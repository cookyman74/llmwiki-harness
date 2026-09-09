#!/usr/bin/env python3
"""make-synthetic-vault.py — P2-30 성능 측정용 합성 볼트 생성기 (stdlib only, 결정적).

    python3 make-synthetic-vault.py <out_dir> [--pages N] [--seed S] [--mocs M]

<out_dir>/wiki/{L2-episodic,L3-semantic,L4-procedural,moc}/ 아래에 N 페이지를 만든다.
  - frontmatter: type · title · aliases(1–2개 합성) · confidence · created/updated · status
  - 본문: 합성 단어 문단(~1–3 KB), `- claim::` 1–3줄, `[[wikilink]]` 2–6개, 일부 `## 관계` 절
  - MoC M개(기본 10): 멤버 20–60개 링크
내용은 전부 합성 단어(음절 조합)다 — 실 볼트 콘텐츠·slug 는 절대 넣지 않는다.
동일 seed → 바이트 동일 출력(random.Random(seed) 만 사용, 시간·경로 무관).
"""
from __future__ import annotations

import argparse
import os
import random
import sys

SYLL = ["ka", "ri", "to", "mu", "ne", "so", "va", "li", "do", "pe", "zu", "fa", "gi", "ho", "wa", "xe", "yo", "bu", "ce", "qi"]
# 검색 seed 용으로 항상 어휘에 포함되는 고정 토큰(측정 커맨드 `--once expand foo bar` 가 seed 를 얻도록).
FIXED = ["foo", "bar", "baz", "qux"]
PREDS = ["uses", "depends_on", "caused", "fixed", "contradicts", "supersedes"]
KINDS = [  # (dir, type, weight)
    ("L3-semantic", "fact", 30),
    ("L3-semantic", "entity", 15),
    ("L3-semantic", "concept", 25),
    ("L2-episodic", "source", 12),
    ("L2-episodic", "session", 6),
    ("L4-procedural", "procedure", 12),
]


def word(rng: random.Random) -> str:
    if rng.random() < 0.04:
        return rng.choice(FIXED)
    return "".join(rng.choice(SYLL) for _ in range(rng.randint(2, 4)))


def sentence(rng: random.Random, n: int | None = None) -> str:
    n = n or rng.randint(6, 14)
    ws = [word(rng) for _ in range(n)]
    ws[0] = ws[0].capitalize()
    return " ".join(ws) + "."


def paragraph(rng: random.Random, target_bytes: int) -> str:
    out: list[str] = []
    size = 0
    while size < target_bytes:
        s = sentence(rng)
        out.append(s)
        size += len(s) + 1
    return " ".join(out)


def pick_kind(rng: random.Random) -> tuple[str, str]:
    total = sum(w for _, _, w in KINDS)
    r = rng.uniform(0, total)
    for d, t, w in KINDS:
        r -= w
        if r <= 0:
            return d, t
    return KINDS[0][0], KINDS[0][1]


def build(out_dir: str, pages: int, mocs: int, seed: int) -> dict[str, int]:
    rng = random.Random(seed)
    n_regular = max(0, pages - mocs)
    # 1) slug 목록을 먼저 확정(링크 타겟이 존재하도록).
    regular: list[tuple[str, str, str]] = []  # (dir, type, slug)
    seen: set[str] = set()
    i = 0
    while len(regular) < n_regular:
        d, t = pick_kind(rng)
        slug = f"{t}-{word(rng)}-{word(rng)}-{i:04d}"
        i += 1
        if slug in seen:
            continue
        seen.add(slug)
        regular.append((d, t, slug))
    moc_slugs = [f"{word(rng)}-moc-{k:02d}" for k in range(mocs)]
    all_slugs = [s for _, _, s in regular] + moc_slugs

    wiki = os.path.join(out_dir, "wiki")
    for d in ("L2-episodic", "L3-semantic", "L4-procedural", "moc"):
        os.makedirs(os.path.join(wiki, d), exist_ok=True)

    total_bytes = 0
    # 2) 일반 페이지
    for d, t, slug in regular:
        aliases = [word(rng) + " " + word(rng)]
        if rng.random() < 0.5:
            aliases.append(word(rng))
        conf = rng.choice([0.6, 0.85, 0.95])
        status = "stale" if rng.random() < 0.08 else "active"
        n_links = rng.randint(2, 6)
        targets = rng.sample(all_slugs, n_links)
        target_kb = rng.randint(1000, 3000)
        lines = [
            "---",
            f"type: {t}",
            f"title: {sentence(rng, 3)[:-1]}",
            f"aliases: [{', '.join(aliases)}]",
            "tags: [synthetic]",
            "created: 2026-01-01",
            "updated: 2026-01-02",
            f"confidence: {conf}",
            f"sources: [{word(rng)}, {word(rng)}]",
            "last_confirmed: 2026-01-02",
            f"status: {status}",
            "---",
            f"# {sentence(rng, 3)[:-1]}",
            "",
        ]
        for _ in range(rng.randint(1, 3)):
            lines.append(f"- claim:: {sentence(rng)}")
        lines.append("")
        body = paragraph(rng, target_kb // 2)
        # 링크를 문단 사이에 삽입
        for tg in targets[: max(1, n_links // 2)]:
            body += f" {sentence(rng, 4)[:-1]} [[{tg}]]."
        lines.append(body)
        lines.append("")
        lines.append(paragraph(rng, target_kb // 2))
        lines.append("")
        rest = targets[max(1, n_links // 2):]
        if t == "procedure":
            lines.append("## steps")
            for k in range(rng.randint(3, 6)):
                lines.append(f"{k + 1}. {sentence(rng)}")
            lines.append("")
        if rest and rng.random() < 0.6:
            lines.append("## 관계")
            for tg in rest:
                pred = rng.choice(PREDS)
                lines.append(f"- {pred} :: [[{tg}]] (sources: {rng.randint(1, 4)}, confidence: {rng.choice([0.6, 0.85, 0.95])})")
            lines.append("")
        elif rest:
            lines.append(" ".join(f"[[{tg}]]" for tg in rest))
            lines.append("")
        text = "\n".join(lines)
        total_bytes += len(text.encode("utf-8"))
        with open(os.path.join(wiki, d, slug + ".md"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)

    # 3) MoC 페이지
    regular_slugs = [s for _, _, s in regular]
    for ms in moc_slugs:
        k = min(len(regular_slugs), rng.randint(20, 60))
        members = rng.sample(regular_slugs, k) if k else []
        lines = [
            "---",
            "type: moc",
            f"title: {sentence(rng, 2)[:-1]} MoC",
            "aliases: []",
            "tags: [synthetic, moc]",
            "created: 2026-01-01",
            "updated: 2026-01-02",
            "---",
            f"# {sentence(rng, 2)[:-1]} MoC",
            "",
            sentence(rng),
            "",
            "## 멤버",
        ]
        for m in members:
            lines.append(f"- [[{m}]] — {sentence(rng, 4)}")
        lines.append("")
        text = "\n".join(lines)
        total_bytes += len(text.encode("utf-8"))
        with open(os.path.join(wiki, "moc", ms + ".md"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)

    # 4) 루트 index.md / log.md (CLI 의 <root>/wiki 존재 검사만 필요하지만 실 볼트 모양을 맞춘다)
    with open(os.path.join(out_dir, "index.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("---\ntype: index\ntitle: synthetic index\n---\n" + "\n".join(f"- [[{s}]]" for s in all_slugs) + "\n")
    with open(os.path.join(out_dir, "log.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("---\ntype: log\ntitle: synthetic log\n---\n## [2026-01-01] generate | synthetic vault\n")
    return {"pages": len(all_slugs), "mocs": len(moc_slugs), "bytes": total_bytes}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out_dir")
    ap.add_argument("--pages", type=int, default=1000)
    ap.add_argument("--mocs", type=int, default=10)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args(argv)
    if a.pages < a.mocs + 1:
        ap.error("--pages must exceed --mocs")
    stats = build(a.out_dir, a.pages, a.mocs, a.seed)
    print(f"out={a.out_dir} pages={stats['pages']} mocs={stats['mocs']} bytes={stats['bytes']} avg_bytes={stats['bytes'] // stats['pages']} seed={a.seed}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

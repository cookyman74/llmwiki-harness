#!/usr/bin/env python3
"""사전스코프 그래프 확장 + 컨텍스트 팩 (deterministic — 0 LLM 토큰).

순수 lexical 스코프(search.py --files)는 관계/내비게이션으로 연결된 페이지에 못 닿아
recall이 떨어진다(A/B 3차에서 실측). 이 스크립트는 lexical seed에서 **관계 1홉**
(아웃링크·인링크·MoC 멤버)을 확장해 그 공백을 결정적으로 메운다. index 통독 없이.

모드:
  expand : 키워드 → lexical seed(본문+aliases 매치) → 1홉 확장 → 랭크된 후보 slug
  pack   : 주어진 slug들의 frontmatter(type/confidence/status) + claims:: 만 추출.
           본문 산문을 빼 토큰·왕복을 줄이는 컨텍스트 팩(claims = 이미 증류된 사실).

Usage:
  scope-expand.py expand "<kw>" [kw ...] [--root .] [--top-seed 6] [--max 15]
  scope-expand.py pack <slug> [slug ...] [--root .]

한계(문서화):
- 매 호출 wiki/ 전체 그래프 재구성(캐시 없음). ~수백 페이지까진 <1s로 OK. 수천 규모면
  mtime 기반 증분 캐시(.graph-cache.json) 필요 — 현 규모(≈180)에선 불필요(YAGNI).
- index.md·log.md는 root/wiki 밖이라 스코프 제외 → seed 독식 없음(search.py와 동일).
- claim은 한 줄(`- claim:: …`) 관례. 멀티라인 claim은 위키 규약상 없음.
"""
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

LINK = re.compile(r"(?<!!)\[\[([^\]|#]+)")  # 이미지 임베드 ![[...]]는 제외(agy)


def walk_md(base):
    for dp, _, files in os.walk(base):
        for f in sorted(files):
            if f.endswith(".md"):
                yield os.path.join(dp, f), f[:-3]


def read(path):
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def frontmatter(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return ""
    out = []
    for ln in lines[1:201]:
        if ln.strip() == "---":
            return "\n".join(out)
        out.append(ln)
    return ""


def field(fm, name):
    m = re.search(rf"^{name}:\s*(.+)$", fm, re.MULTILINE)
    return m.group(1).strip() if m else ""


def build_graph(base):
    """slug -> dict(type, aliases, out=set(slug), text). + alias->slug map. + inlinks."""
    G = {}
    alias2slug = {}
    for path, slug in walk_md(base):
        text = read(path)
        fm = frontmatter(text)
        typ = field(fm, "type") or os.path.basename(os.path.dirname(path))
        aliases = field(fm, "aliases")
        out = set(m.strip() for m in LINK.findall(text))
        G[slug] = {"type": typ, "aliases": aliases, "out": out, "text": text}
        alias2slug[slug.lower()] = slug
        for a in re.findall(r"[^\[\],]+", aliases.strip("[] ")):
            a = a.strip().strip("'\"")
            if a:
                alias2slug.setdefault(a.lower(), slug)
    # 링크 타겟을 실제 slug로 정규화(별칭/제목 링크 대응) + 인링크 구성
    inl = {s: set() for s in G}
    for s, d in G.items():
        norm = set()
        for t in d["out"]:
            key = t.lower()
            tgt = t if t in G else alias2slug.get(key)
            if tgt and tgt in G and tgt != s:
                norm.add(tgt)
                inl[tgt].add(s)
        d["out"] = norm
    for s in G:
        G[s]["in"] = inl[s]
    return G


MEMBER_K = 6  # MoC당 멤버 확장 상한(lexical 랭크 상위). hard 컷 대신 소프트 Top-K(agy)


def lex_score(d, terms):
    hay = (d["text"] + "\n" + d["aliases"]).lower()
    distinct = sum(1 for t in terms if t in hay)
    total = sum(hay.count(t) for t in terms)
    return distinct, total


def lexical_seeds(G, terms, top):
    scored = []
    for s, d in G.items():
        distinct, total = lex_score(d, terms)
        if distinct:
            scored.append((distinct, total, s))
    scored.sort(key=lambda r: (-r[0], -r[1], r[2]))
    return [s for _, _, s in scored[:top]]


def expand(G, terms, seeds, max_out):
    """seed ∪ 1홉(아웃·인) ∪ MoC 멤버(소프트 Top-K).

    설계(agy 리뷰 반영):
    - 1홉 이웃(tier1)은 lexical 관련성으로 필터(노이즈 억제).
    - MoC 멤버(tier2)는 **lexical 필터를 우회**하되 MoC당 lexical 상위 K개만(MEMBER_K).
      → 어휘 매치 없이 관계로만 닿는 엔티티(그래프 확장의 핵심 목적)를 보존하면서,
        큰 MoC(claude-code-moc 50멤버)·루트 허브(home-moc) 폭발은 Top-K로 바운드.
        hard outdegree 컷(멤버 통째 차단=정보절벽)을 대체."""
    lex = {s: lex_score(G[s], terms)[0] for s in G}  # distinct 캐시(멤버 랭킹용)
    cand = {}   # slug -> [tier, seed_refs]
    kept2 = set()  # tier2(MoC멤버)로 확정 채택 — lexical 필터 우회

    def bump(n, tier):
        if n not in cand:
            cand[n] = [tier, 0]
        cand[n][0] = min(cand[n][0], tier)
        cand[n][1] += 1

    for s in seeds:
        cand[s] = [0, 99]  # tier0 = seed

    moc_seen = set()
    for s in seeds:
        d = G.get(s, {})
        neighbors = (d.get("out", set()) | d.get("in", set()))
        for n in neighbors:
            bump(n, 1)
        # seed 또는 이웃인 MoC의 멤버를 소프트 Top-K로 확장(lexical 우선, 어휘0도 허용)
        moc_nodes = ([s] if d.get("type") == "moc" else [])
        moc_nodes += [n for n in neighbors if G.get(n, {}).get("type") == "moc"]
        for mnode in moc_nodes:
            if mnode in moc_seen:
                continue
            moc_seen.add(mnode)
            members = list(G.get(mnode, {}).get("out", set()))
            members.sort(key=lambda m: (-lex.get(m, 0), m))
            for m in members[:MEMBER_K]:
                bump(m, 2)
                kept2.add(m)

    rows = []
    for slug, (tier, refs) in cand.items():
        if tier == 0 or slug in kept2:
            rows.append((tier, -lex.get(slug, 0), refs, slug)); continue
        # tier1 순수 1홉 이웃만 lexical 필터(distinct>0 또는 seed 2개+ 참조)
        if lex.get(slug, 0) > 0 or refs >= 2:
            rows.append((tier, -lex.get(slug, 0), refs, slug))
    rows.sort(key=lambda r: (r[0], r[1], -r[2], r[3]))
    return [(slug, [tier, refs]) for tier, _, refs, slug in rows[:max_out]]


import math


def _score_text(d):
    """스코어링용 텍스트 — 링크 타겟·URL 제거(dl 왜곡 방지, agy #3). 소문자."""
    t = d["text"] + "\n" + d["aliases"]
    t = re.sub(r"\]\([^)]*\)", "]", t)      # [텍스트](url) → 텍스트만
    t = re.sub(r"https?://\S+", "", t)       # 맨 URL 제거
    return t.lower()


def bm25_rank(G, terms, cand_slugs, k1=1.5, b=0.75):
    """후보를 BM25로 재순위(0토큰). IDF는 전체 코퍼스(G), tf·dl은 후보 본문+aliases.
    그래프 확장(recall)으로 모은 pool을 질의 관련도(precision)로 좁히는 rerank 단계.
    정렬은 (score desc, slug) — 동점도 slug로 결정적(불안정 정렬 아님, agy #4)."""
    terms = list(dict.fromkeys(t for t in terms if len(t) >= 2))  # 중복제거+1글자 제외(agy #1·#2)
    N = len(G)
    texts = {s: _score_text(G[s]) for s in G}
    avgdl = sum(len(t) for t in texts.values()) / max(N, 1)
    idf = {}
    for t in terms:
        df = sum(1 for tx in texts.values() if t in tx)
        idf[t] = math.log((N - df + 0.5) / (df + 0.5) + 1)
    scores = {}
    for s in cand_slugs:
        tx = texts.get(s, "")
        dl = len(tx) or 1
        sc = 0.0
        for t in terms:
            tf = tx.count(t)
            if tf:
                sc += idf[t] * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))
        scores[s] = sc
    return sorted(cand_slugs, key=lambda s: (-scores[s], s)), scores


def do_expand(terms, root, top_seed, max_out, rerank_n=0):
    base = os.path.join(root, "wiki")
    G = build_graph(base)
    tl = [t.lower() for t in terms if t.strip()]
    seeds = lexical_seeds(G, tl, top_seed)
    if not seeds:
        print(f"no lexical seed for: {' '.join(terms)}")
        return
    rows = expand(G, tl, seeds, max_out)
    tiers = {0: "seed", 1: "1hop", 2: "moc"}
    if rerank_n:
        # 확장 pool을 BM25로 재순위 → 질의 관련 top-N만(pack/read 대상 축소)
        pool = [slug for slug, _ in rows]
        ranked, sc = bm25_rank(G, tl, pool)
        tier_of = {slug: tier for slug, (tier, _) in rows}
        for slug in ranked[:rerank_n]:
            print(f"{tiers[tier_of[slug]]}\t{sc[slug]:.1f}\t{slug}\t{G.get(slug, {}).get('type', '?')}")
    else:
        for slug, (tier, refs) in rows:
            print(f"{tiers[tier]}\t{refs}\t{slug}\t{G.get(slug, {}).get('type', '?')}")


def do_pack(slugs, root):
    base = os.path.join(root, "wiki")
    # slug -> path
    idx = {slug: path for path, slug in walk_md(base)}
    for slug in slugs:
        p = idx.get(slug)
        if not p:
            print(f"## {slug}\n(없음)\n")
            continue
        text = read(p)
        fm = frontmatter(text)
        conf = field(fm, "confidence") or "-"
        status = field(fm, "status") or "active"
        typ = field(fm, "type") or "?"
        print(f"## {slug}  [{typ} · conf {conf} · {status}]")
        claims = re.findall(r"^-?\s*claim::\s*(.+)$", text, re.MULTILINE)
        if claims:
            for c in claims:
                print(f"- {c.strip()}")
        else:
            # claims 없는 페이지(개념/엔티티)는 첫 실문단 1개만
            # 헤더(#)·이미지(!)·인용(>)·표(|)·리스트기호는 건너뜀(agy: 오인 방지)
            body = text.split("---", 2)[-1]
            para = ""
            for ln in body.split("\n"):
                t = ln.strip()
                if t and t[0] not in "#!>|-" and not t.startswith("["):
                    para = t; break
            if para:
                print(f"- (요약) {para}")
        print()


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("expand", "pack"):
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    mode = args[0]
    root, top_seed, max_out, rerank_n = ".", 6, 15, 0
    rest = []
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--root":
            root = args[i + 1]; i += 2
        elif a == "--top-seed":
            top_seed = int(args[i + 1]); i += 2
        elif a == "--max":
            max_out = int(args[i + 1]); i += 2
        elif a == "--rerank":
            rerank_n = int(args[i + 1]); i += 2
        else:
            rest.append(a); i += 1
    if mode == "expand":
        do_expand(rest, root, top_seed, max_out, rerank_n)
    else:
        do_pack(rest, root)


if __name__ == "__main__":
    main()

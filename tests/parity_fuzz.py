#!/usr/bin/env python3
"""차등 퍼징 — 픽스처 볼트에서 무작위 질의·옵션을 만들어 Python 정본과 Node 포팅의 stdout 을 비교한다.

고정 골든셋(tests/parity.py)이 "우연히 통과"하는 사각지대를 좁히기 위한 보조 도구(v0.8.6 P1).
seed 를 고정하면 결정적이다. rerank 모드는 점수 열만 ±0.05 허용, 나머지는 바이트 동일.

Usage:
  python3 tests/parity_fuzz.py [--n 200] [--seed 20260909] [--root tools/llmwiki-mcp/test/fixtures/vault]
Exit 0 = 전건 일치, 1 = 불일치(처음 5건 출력), 2 = 준비 오류(node build 없음).
"""
import argparse
import math
import os
import random
import re
import shutil
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPTS = os.path.join(REPO, ".claude", "skills", "wiki-lint", "scripts")
NODE_CLI = os.path.join(REPO, "tools", "llmwiki-mcp", "dist", "cli.js")

VOCAB = ["벡터", "인덱스", "rerank", "Rerank", "청킹", "chunking", "지연", "팀", "별칭페이지", "검색", "northwind",
         "Northwind", "캐싱", "prompt", "평가", "harness", "절차", "지도", "MoC", "정렬테스트", "GraphRAG", "🦀",
         "a", "ab", "가", "ZZZ", "claim", "uses", "사용함", "index", "", " ", "---", "[[", "dup-note"]
SLUGS = ["concept-vector-index", "dup-note", "procedure-no-type", "zz-🦀-crab", "zz-￦-won", "nonexistent",
         "search-moc", "concept-linker", "fact-latency-budget-old", "entity-northwind-team", "concept-reranking", "home-moc"]


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, cwd=REPO)
    return r.stdout


def rerank_ok(py: bytes, nd: bytes) -> bool:
    if py == nd:
        return True
    a = [x.split("\t") for x in py.decode("utf-8", "replace").splitlines()]
    b = [x.split("\t") for x in nd.decode("utf-8", "replace").splitlines()]
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if len(x) != 4 or len(y) != 4 or x[0] != y[0] or x[2:] != y[2:]:
            return False
        # 점수 열은 `.1f` 형식·유한값 — NaN 이 |Δ| 비교를 통과하는 허점 차단(agy P1 2차 리뷰 #2, parity.py 와 동일 기준)
        if not (re.fullmatch(r"-?\d+\.\d", x[1]) and re.fullmatch(r"-?\d+\.\d", y[1])):
            return False
        if not (math.isfinite(float(x[1])) and math.isfinite(float(y[1]))):
            return False
        if abs(float(x[1]) - float(y[1])) > 0.05:
            return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20260909)
    ap.add_argument("--root", default=os.path.join(REPO, "tools", "llmwiki-mcp", "test", "fixtures", "vault"))
    a = ap.parse_args()
    node = shutil.which("node")
    if not node or not os.path.isfile(NODE_CLI):
        print(f"SETUP ERROR: node or {NODE_CLI} missing — cd tools/llmwiki-mcp && npm ci && npm run build")
        return 2
    rnd = random.Random(a.seed)
    se, sr = os.path.join(SCRIPTS, "scope-expand.py"), os.path.join(SCRIPTS, "search.py")
    N = [node, NODE_CLI, "--once"]
    fails = []
    for _ in range(a.n):
        terms = [rnd.choice(VOCAB) for _ in range(rnd.randint(1, 4))]
        if rnd.random() < 0.3:
            terms.append(rnd.choice(terms))  # 중복 term
        mode = rnd.choice(["search", "expand", "rerank", "pack"])
        if mode == "search":
            top = rnd.choice([0, 1, 3, 8, 50])
            pc, nc = [sr, "--files", *terms, "--root", a.root, "--top", str(top)], ["search", *terms, "--root", a.root, "--top", str(top)]
            label = terms
        elif mode == "pack":
            sl = [rnd.choice(SLUGS) for _ in range(rnd.randint(1, 4))]
            pc, nc, label = [se, "pack", *sl, "--root", a.root], ["pack", *sl, "--root", a.root], sl
        else:
            ts, mx = rnd.choice([1, 2, 6, 20]), rnd.choice([0, 1, 5, 15, 40])
            rr = rnd.choice([1, 3, 11, 50]) if mode == "rerank" else 0
            opt = ["--root", a.root, "--top-seed", str(ts), "--max", str(mx)] + (["--rerank", str(rr)] if rr else [])
            pc, nc, label = [se, "expand", *terms, *opt], ["expand", *terms, *opt], terms + opt[2:]
        py, nd = run([sys.executable, *pc]), run([*N, *nc])
        ok = rerank_ok(py, nd) if mode == "rerank" else py == nd
        if not ok:
            fails.append((mode, label, py[:300], nd[:300]))
    print(f"differential fuzz: {a.n - len(fails)}/{a.n} agree (seed={a.seed})")
    for mode, label, py, nd in fails[:5]:
        print(f"FAIL {mode} {label}\n  py: {py!r}\n  nd: {nd!r}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

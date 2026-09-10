#!/usr/bin/env python3
"""패리티 골든셋 생성 (P0-34) — queries.json × 4모드를 Python 정본으로 실행해 expected/ 에 저장.

Usage:
  python3 gen-expected.py            # expected/<id>-<mode>.txt 생성(덮어쓰기)
  python3 gen-expected.py --check    # 재생성 결과가 디스크와 동일한지 검사(exit 1 = 불일치)

정본 스크립트는 저장소의 .claude/skills/wiki-lint/scripts/ 에서 찾는다(P0-12~14 결정성 수정본).
출력은 stdout 바이트 그대로 저장한다(마지막 개행 포함).
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SCRIPTS = os.path.join(REPO, ".claude", "skills", "wiki-lint", "scripts")
VAULT = os.path.join(HERE, "vault")
EXPECTED = os.path.join(HERE, "expected")
PY = sys.executable


def run(*args):
    r = subprocess.run([PY, *args], capture_output=True, timeout=60)
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode("utf-8", "replace"))
        raise SystemExit(f"command failed: {' '.join(args)}")
    return r.stdout


def commands(q, d):
    se = os.path.join(SCRIPTS, "scope-expand.py")
    sr = os.path.join(SCRIPTS, "search.py")
    t = q["terms"]
    return {
        "search": [sr, "--files", *t, "--root", VAULT, "--top", str(d["search_top"])],
        "expand": [se, "expand", *t, "--root", VAULT, "--top-seed", str(d["expand_top_seed"]), "--max", str(d["expand_max"])],
        "rerank": [se, "expand", *t, "--root", VAULT, "--top-seed", str(d["expand_top_seed"]), "--max", str(d["rerank_max"]), "--rerank", str(d["rerank_n"])],
        "pack": [se, "pack", *q["pack_slugs"], "--root", VAULT],
    }


def main():
    with open(os.path.join(HERE, "queries.json"), encoding="utf-8") as fh:
        spec = json.load(fh)
    d = spec["defaults"]
    check = "--check" in sys.argv
    os.makedirs(EXPECTED, exist_ok=True)
    bad, n = [], 0
    for q in spec["queries"]:
        for mode, cmd in commands(q, d).items():
            out = run(*cmd)
            p = os.path.join(EXPECTED, f"{q['id']}-{mode}.txt")
            n += 1
            if check:
                try:
                    with open(p, "rb") as fh:
                        if fh.read() != out:
                            bad.append(os.path.basename(p))
                except OSError:
                    bad.append(os.path.basename(p))
            else:
                with open(p, "wb") as fh:
                    fh.write(out)
    if check:
        if bad:
            print("MISMATCH:\n  " + "\n  ".join(bad))
            sys.exit(1)
        print(f"expected OK ({n} files)")
    else:
        print(f"wrote {n} files under expected/")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""위키 본문 검색 (deterministic — 0 LLM 토큰). search.sh의 python 포팅.

index.md가 부족할 때 wiki/ 페이지 본문을 리터럴(대소문자 무시) 검색. 벡터/rg 불필요.
Usage: search.py "<query>" [vault_root]
출력: <파일>:<라인번호>: <매칭 라인>  (±0 컨텍스트)
"""
import os
import sys


def main():
    if len(sys.argv) < 2:
        print("usage: search.py <query> [vault_root]", file=sys.stderr)
        sys.exit(2)
    q = sys.argv[1].lower()
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    base = os.path.join(root, "wiki")
    hits = 0
    for dp, _, files in os.walk(base):
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            try:
                with open(p, encoding="utf-8-sig", errors="replace") as fh:
                    for i, line in enumerate(fh, 1):
                        if q in line.lower():
                            print(f"{rel}:{i}: {line.rstrip()}")
                            hits += 1
            except OSError:
                continue
    if hits == 0:
        print(f"no matches for: {sys.argv[1]}")


if __name__ == "__main__":
    main()

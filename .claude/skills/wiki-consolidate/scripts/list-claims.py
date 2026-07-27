#!/usr/bin/env python3
"""L2 주장(claim::) 수집 (deterministic — 0 LLM 토큰). list-claims.sh의 python 포팅.

L2-episodic의 `- claim:: <text>` 인라인 필드를 모아, 같은 주장이 3회+ 등장하는지
LLM이 클러스터링(배치 병합·승격)하는 입력을 만든다.
Usage: list-claims.py [vault_root] [tier_dir]  (default: . wiki/L2-episodic)
출력: <file>\t<claim text>  (정렬)
"""
import os
import re
import sys

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

CLAIM = re.compile(r"claim::\s*(.*)$")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    tier = sys.argv[2] if len(sys.argv) > 2 else "wiki/L2-episodic"
    base = os.path.join(root, tier)
    if not os.path.isdir(base):
        print(f"no dir: {tier}")
        return
    rows = []
    for dp, _, files in os.walk(base):
        for f in files:
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            try:
                with open(p, encoding="utf-8-sig", errors="replace") as fh:
                    for line in fh:
                        m = CLAIM.search(line)
                        if m:
                            rows.append(f"{rel}\t{m.group(1).strip()}")
            except OSError:
                continue
    if not rows:
        print(f"no claims found in {tier}")
        return
    for r in sorted(rows):
        print(r)


if __name__ == "__main__":
    main()

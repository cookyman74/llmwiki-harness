#!/usr/bin/env python3
"""raw 소스 인제스트 상태 (deterministic — 0 LLM 토큰). ingest-status.sh의 python 포팅.

raw/*.md 맨 위 스탬프(frontmatter `ingest_status: done`)를 읽어 done/pending을 판별.
raw 본문은 immutable — 이 메타 블록만 인제스트가 쓴다.
제외: raw/assets/(이미지) · raw/notes/(데일리 스크래치 — opt-in 인제스트).

Usage: ingest-status.py [vault_root]  (default: .)
출력: DONE <date> <file> | PENDING <file>   그다음 "ingested: N   pending: M"
"""
import os
import re
import sys


def stamp(path):
    """(status, ingested_date). status in done|stale|pending."""
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        head = fh.read(600)
    m = re.search(r"^ingest_status:\s*(\w+)", head, re.MULTILINE)
    st = m.group(1) if m else "pending"
    d = re.search(r"^ingested:\s*([0-9-]+)", head, re.MULTILINE)
    return st, (d.group(1) if d else "?")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    rawdir = os.path.join(root, "raw")
    if not os.path.isdir(rawdir):
        print("no raw/ dir")
        return

    done_n = pend_n = 0
    rows = []
    for dp, dirs, files in os.walk(rawdir):
        # assets/ · notes/ 하위 제외
        parts = os.path.relpath(dp, rawdir).split(os.sep)
        if "assets" in parts or "notes" in parts:
            continue
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            st, d = stamp(p)
            rel = os.path.relpath(p, root)
            if st == "done":
                rows.append(f"DONE    {d}  {rel}")
                done_n += 1
            else:
                rows.append(f"{st.upper():8}{rel}")
                pend_n += 1
    for r in sorted(rows):
        print(r)
    print("---")
    print(f"ingested: {done_n}   pending: {pend_n}")


if __name__ == "__main__":
    main()

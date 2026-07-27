#!/usr/bin/env python3
"""위키 lint 경과·백로그 (deterministic — 0 LLM 토큰). lint-due.sh의 python 포팅.

log.md의 마지막 `## [YYYY-MM-DD] lint` 기준 경과일 + L1 미압축수 + BACKLOG(마지막 lint
이후 ingest 수)를 출력. SessionStart 훅(wiki-status-check)이 소비.

Usage: lint-due.py [vault_root] [threshold_days]  (default: . 3)
출력: DUE <days> | OK <days> | NEVER   그다음 L1:<n>  BACKLOG:<n>
"""
import os
import re
import sys
from datetime import date

HEAD = re.compile(r"^## \[(\d{4}-\d{2}-\d{2})\] (\w+)")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    thresh = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    log = os.path.join(root, "log.md")

    last = None
    backlog = 0
    if os.path.isfile(log):
        with open(log, encoding="utf-8-sig", errors="replace") as fh:
            for line in fh:
                m = HEAD.match(line)
                if not m:
                    continue
                op = m.group(2)
                if op == "lint":
                    last = m.group(1)
                    backlog = 0          # lint 볼 때마다 리셋
                elif op == "ingest":
                    backlog += 1

    l1 = 0
    l1dir = os.path.join(root, "wiki", "L1-working")
    if os.path.isdir(l1dir):
        l1 = sum(1 for f in os.listdir(l1dir) if f.endswith(".md"))

    if not last:
        print("NEVER")
    else:
        try:
            days = (date.today() - date.fromisoformat(last)).days
        except ValueError:
            days = 0
        days = max(0, days)
        print(f"DUE {days}" if days > thresh else f"OK {days}")
    print(f"L1:{l1}")
    print(f"BACKLOG:{backlog}")


if __name__ == "__main__":
    main()

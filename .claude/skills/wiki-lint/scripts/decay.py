#!/usr/bin/env python3
"""Ebbinghaus forgetting curve for wiki pages (deterministic — 0 LLM tokens).

Retention R = exp(-Δdays / S), where S (stability, days) depends on decay_class.
Reconfirming a page = set last_confirmed to today => Δ=0 => R=1.0 (reset).

decay_class -> stability S (days):
  architecture : 365   (major design decisions — forget slowly)
  procedure    : 365   (L4 procedural memory — durable)
  concept      : 120   (semantic concepts)
  semantic     : 120   (alias for concept-level facts)
  entity       :  90
  episodic     :  21   (session/source records — fade)
  transient    :   7   (transient bugs, one-off observations — forget fast)
  default      :  90

R thresholds (advisory, for lint):
  R >= 0.5  fresh
  0.3<=R<0.5 aging   -> consider reconfirming
  R < 0.3   faded    -> forgetting candidate (archive / destage — NEVER auto-delete)

Modes:
  decay.py --class architecture --last 2026-01-01 [--today YYYY-MM-DD]
      -> prints "0.42 aging"
  decay.py --scan [vault_root] [--today YYYY-MM-DD] [--json]
      -> walks wiki/**.md, reads frontmatter decay_class + last_confirmed
         (falls back to updated:), prints faded/aging pages sorted by R.
"""
import argparse
import json
import math
import os
import re
from datetime import date
import sys

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

STABILITY = {
    "architecture": 365, "procedure": 365, "concept": 120, "semantic": 120,
    "entity": 90, "episodic": 21, "transient": 7, "default": 90,
}


def band(r):
    if r >= 0.5:
        return "fresh"
    if r >= 0.3:
        return "aging"
    return "faded"


def retention(decay_class, last_confirmed, today):
    s = STABILITY.get((decay_class or "default").lower(), STABILITY["default"])
    delta = max(0, (today - last_confirmed).days)
    return round(math.exp(-delta / s), 3)


def parse_date(s):
    return date.fromisoformat(s.strip())


def read_fm(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        head = fh.read(600)
    fm = {}
    for key in ("type", "decay_class", "last_confirmed", "updated", "status"):
        m = re.search(rf"^{key}:\s*(\S+)", head, re.MULTILINE)
        if m:
            fm[key] = m.group(1)
    return fm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--class", dest="klass")
    ap.add_argument("--last")
    ap.add_argument("--today")
    ap.add_argument("--scan", nargs="?", const=".", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    today = parse_date(a.today) if a.today else date.today()

    if a.scan is not None:
        rows = []
        for dp, _, files in os.walk(os.path.join(a.scan, "wiki")):
            for f in files:
                if not f.endswith(".md"):
                    continue
                p = os.path.join(dp, f)
                fm = read_fm(p)
                lc = fm.get("last_confirmed") or fm.get("updated")
                if not lc:
                    continue
                try:
                    r = retention(fm.get("decay_class") or fm.get("type"), parse_date(lc), today)
                except ValueError:
                    continue
                rows.append({"page": os.path.relpath(p, a.scan), "R": r,
                             "band": band(r), "class": fm.get("decay_class") or fm.get("type"),
                             "last_confirmed": lc, "status": fm.get("status", "")})
        rows.sort(key=lambda x: x["R"])
        if a.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            faded = [r for r in rows if r["band"] == "faded" and r["status"] != "stale"]
            aging = [r for r in rows if r["band"] == "aging"]
            print(f"scanned: {len(rows)}  faded: {len(faded)}  aging: {len(aging)}")
            for r in faded + aging:
                print(f"  R={r['R']:.2f} {r['band']:5} {r['class'] or '?':12} {r['page']}")
        return

    if a.klass and a.last:
        r = retention(a.klass, parse_date(a.last), today)
        print(f"{r} {band(r)}")
    else:
        ap.error("provide --scan or (--class and --last)")


if __name__ == "__main__":
    main()

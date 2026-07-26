#!/usr/bin/env python3
"""Confidence score for a wiki claim (deterministic — 0 LLM tokens).

Rules (LLM Wiki v2):
  base by confirmed source count:
    1 source   -> 0.60
    2 sources  -> 0.85
    3+ sources -> 0.95
    0 sources  -> 0.30 (unconfirmed / single-observation)
  modifiers (applied once each, on presence):
    +0.10 if any source is official docs or code
    -0.10 if the claim rests on verbal sources (slack / meeting notes)
  final clamped to [0.0, 1.0].

Usage:
  confidence.py --count N [--official] [--verbal]
  confidence.py --kinds official,normal,verbal   # count inferred from list
Source kinds: official | code | verbal | normal
  (official & code -> +0.10 ; verbal -> -0.10)

Prints the score (e.g. 0.95). --json for {score, base, mods}.
"""
import argparse
import json
import sys


def base_for(n):
    if n >= 3:
        return 0.95
    if n == 2:
        return 0.85
    if n == 1:
        return 0.60
    return 0.30


def score(count, has_official, has_verbal):
    b = base_for(count)
    mod = 0.0
    if has_official:
        mod += 0.10
    if has_verbal:
        mod -= 0.10
    return max(0.0, min(1.0, round(b + mod, 2))), b, mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int)
    ap.add_argument("--official", action="store_true")
    ap.add_argument("--verbal", action="store_true")
    ap.add_argument("--kinds", help="comma list: official,code,verbal,normal")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.kinds is not None:
        kinds = [k.strip().lower() for k in a.kinds.split(",") if k.strip()]
        count = len(kinds)
        has_official = any(k in ("official", "code") for k in kinds)
        has_verbal = any(k == "verbal" for k in kinds)
    elif a.count is not None:
        count, has_official, has_verbal = a.count, a.official, a.verbal
    else:
        ap.error("provide --count or --kinds")

    s, b, mod = score(count, has_official, has_verbal)
    if a.json:
        print(json.dumps({"score": s, "base": b, "mod": round(mod, 2),
                          "count": count, "official": has_official, "verbal": has_verbal}))
    else:
        print(s)


if __name__ == "__main__":
    main()

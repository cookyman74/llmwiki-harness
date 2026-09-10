#!/usr/bin/env python3
"""bench.py — P2-29/P2-30 측정 하네스 (stdlib only).

    python3 bench.py --root <vault> [--runs 5] [--label name] [--cli tools/llmwiki-mcp/dist/cli.js]
                     [--expand-terms foo bar] [--max 20] [--rerank 11] [--no-expand] [--json]

측정 항목(각 runs 회, median/min/max):
  selftest  : `node cli.js --selftest --root R` 의 stdout 에서 pages/mocs/buildGraph_ms/startup_to_ready_ms 파싱
              + 프로세스 wall(ms, perf_counter — node 부트 포함)
  expand    : `node cli.js --once expand <terms> --root R --max M --rerank K` 의 wall(ms) + 출력 행 수
출력에는 slug·본문을 싣지 않는다(숫자·개수만) — baseline/ 파일에 그대로 붙여도 볼트 내용이 새지 않도록.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CLI = os.path.normpath(os.path.join(HERE, "..", "..", "dist", "cli.js"))
FIELDS = ("pages", "mocs", "buildGraph_ms", "startup_to_ready_ms")


def run(cmd: list[str], env: dict[str, str] | None = None) -> tuple[float, str, str, int]:
    t0 = time.perf_counter()
    p = subprocess.run(cmd, capture_output=True, text=True, env=env)
    wall = (time.perf_counter() - t0) * 1000.0
    return wall, p.stdout, p.stderr, p.returncode


def summarize(xs: list[float]) -> dict[str, float]:
    return {"median": round(statistics.median(xs), 1), "min": round(min(xs), 1), "max": round(max(xs), 1), "n": len(xs)}


def bench_selftest(cli: str, root: str, runs: int, env: dict[str, str]) -> dict:
    series: dict[str, list[float]] = {f: [] for f in FIELDS}
    series["wall_ms"] = []
    for _ in range(runs):
        wall, out, err, rc = run(["node", cli, "--selftest", "--root", root], env)
        if rc != 0:
            raise SystemExit(f"selftest failed rc={rc}: {err.strip()[:200]}")
        for f in FIELDS:
            m = re.search(rf"^{f}: (\d+)$", out, re.M)
            if not m:
                raise SystemExit(f"selftest output missing {f}")
            series[f].append(float(m.group(1)))
        series["wall_ms"].append(wall)
    return {k: summarize(v) for k, v in series.items()}


def bench_expand(cli: str, root: str, runs: int, terms: list[str], mx: int, rerank: int, env: dict[str, str]) -> dict:
    walls: list[float] = []
    rows: list[float] = []
    for _ in range(runs):
        wall, out, err, rc = run(["node", cli, "--once", "expand", *terms, "--root", root, "--max", str(mx), "--rerank", str(rerank)], env)
        if rc != 0:
            raise SystemExit(f"expand failed rc={rc}: {err.strip()[:200]}")
        walls.append(wall)
        rows.append(float(len([ln for ln in out.splitlines() if ln.strip()])))
    return {"wall_ms": summarize(walls), "rows": summarize(rows), "args": {"terms_n": len(terms), "max": mx, "rerank": rerank}}


def fmt_table(label: str, res: dict) -> str:
    lines = [f"[{label}]"]
    st = res["selftest"]
    lines.append(f"  pages={int(st['pages']['median'])} mocs={int(st['mocs']['median'])}  (runs={st['pages']['n']})")
    for k in ("buildGraph_ms", "startup_to_ready_ms", "wall_ms"):
        s = st[k]
        lines.append(f"  selftest.{k:<20} median={s['median']:>8.1f}  min={s['min']:>8.1f}  max={s['max']:>8.1f}")
    if "expand" in res:
        ex = res["expand"]
        a = ex["args"]
        lines.append(f"  expand(terms={a['terms_n']}, max={a['max']}, rerank={a['rerank']}) rows={int(ex['rows']['median'])}")
        s = ex["wall_ms"]
        lines.append(f"  expand.wall_ms{'':<14} median={s['median']:>8.1f}  min={s['min']:>8.1f}  max={s['max']:>8.1f}")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True)
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--label", default=None)
    ap.add_argument("--cli", default=DEFAULT_CLI)
    ap.add_argument("--expand-terms", nargs="+", default=["foo", "bar"])
    ap.add_argument("--max", type=int, default=20)
    ap.add_argument("--rerank", type=int, default=11)
    ap.add_argument("--no-expand", action="store_true")
    ap.add_argument("--debug", action="store_true", help="set LLMWIKI_DEBUG=1 for the child")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    env = dict(os.environ)
    if a.debug:
        env["LLMWIKI_DEBUG"] = "1"
    root = os.path.abspath(a.root)
    label = a.label or os.path.basename(root.rstrip(os.sep))
    # warm-up 1회(OS 파일캐시·node 컴파일 캐시) — 측정에 넣지 않음
    run(["node", a.cli, "--selftest", "--root", root], env)
    res: dict = {"selftest": bench_selftest(a.cli, root, a.runs, env)}
    if not a.no_expand:
        res["expand"] = bench_expand(a.cli, root, a.runs, a.expand_terms, a.max, a.rerank, env)
    if a.json:
        print(json.dumps({"label": label, **res}, ensure_ascii=False))
    else:
        print(fmt_table(label, res))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

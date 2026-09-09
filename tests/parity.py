#!/usr/bin/env python3
"""패리티 테스트 (P1-42 · P1-43) — Python 정본 vs Node 포팅(`node dist/cli.js --once …`) 출력 비교.

DESIGN.md §7. 픽스처 볼트(tools/llmwiki-mcp/test/fixtures/vault)의 질의 14개 × 4모드
(search · expand · rerank · pack)를 Python 스크립트와 Node CLI로 각각 실행해 **바이트**로 비교한다.

  * search / expand / pack : stdout 바이트 완전 일치. 불일치면 unified diff 출력.
  * rerank                 : 파서 기반 — `tier\\tscore\\tslug\\ttype` 행의 개수·순서·tier/slug/type 은
                             완전 일치, score 열만 |Δ| ≤ 0.05 허용(log 1 ULP 흡수).
                             "no lexical seed for: …" 단일 행이면 바이트 완전 일치.
  * GOLDEN                 : Python 출력을 커밋된 골든셋 expected/<id>-<mode>.txt 와도 비교해
                             드리프트(Python 스크립트를 고치고 골든셋을 재생성하지 않은 경우)를 따로 보고.

명령 정의는 test/fixtures/gen-expected.py 의 `commands()` 와 동일해야 하며(임포트해 대조 검증),
Python·Node 서브프로세스는 concurrent.futures 로 병렬 실행한다(P0 리뷰: 직렬 56회 ≈7s).

Usage:
  python tests/parity.py                          # 픽스처 패리티 + 골든 드리프트
  python tests/parity.py --node <cli.js 경로>      # Node CLI 경로 재지정
  python tests/parity.py --vault <볼트 경로>       # 실볼트 대표 질의 5개 패리티 (골든 비교 없음)
  python tests/parity.py --vault <경로> --vault-queries q.json   # 실볼트 질의를 파일로 지정

exit 0 = 전건 통과, 1 = 패리티/골든 실패, 2 = 실행 환경 오류(node·dist·스크립트 없음).
크로스플랫폼: shell=True 미사용, sys.executable, shutil.which("node"), 경로에 공백·한국어 허용.
"""
import argparse
import concurrent.futures
import difflib
import hashlib
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

# Windows/비UTF-8 콘솔에서 한글 출력 오류 방지
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(REPO, ".claude", "skills", "wiki-lint", "scripts")
PKG = os.path.join(REPO, "tools", "llmwiki-mcp")
FIXTURES = os.path.join(PKG, "test", "fixtures")
FIX_VAULT = os.path.join(FIXTURES, "vault")
EXPECTED = os.path.join(FIXTURES, "expected")
DEFAULT_CLI = os.path.join(PKG, "dist", "cli.js")
PY = sys.executable or "python"
MODES = ("search", "expand", "rerank", "pack")
SCORE_TOL = 0.05
TIMEOUT = 120

# --vault 기본 질의 5개 (실볼트에 있을 법한 한국어/영문 용어). pack slug 는 실행 시
# Python expand 출력 상위 5개 slug 에서 유도한다.
DEFAULT_VAULT_QUERIES = [
    {"id": "v01", "terms": ["claude", "code", "훅"]},
    {"id": "v02", "terms": ["RAG", "청킹", "임베딩"]},
    {"id": "v03", "terms": ["GPU", "사이징"]},
    {"id": "v04", "terms": ["회의록", "녹음", "전사"]},
    {"id": "v05", "terms": ["AIOps", "MSP"]},
]


# ---------------------------------------------------------------- 명령 정의
def py_commands(q, d, root):
    """gen-expected.py `commands()` 와 동일한 정의 — root 만 매개변수화. 픽스처 모드에서는
    임포트한 원본과 대조해 드리프트를 차단한다(check_commands_match)."""
    se = os.path.join(SCRIPTS, "scope-expand.py")
    sr = os.path.join(SCRIPTS, "search.py")
    t = q["terms"]
    return {
        "search": [sr, "--files", *t, "--root", root, "--top", str(d["search_top"])],
        "expand": [se, "expand", *t, "--root", root, "--top-seed", str(d["expand_top_seed"]),
                   "--max", str(d["expand_max"])],
        "rerank": [se, "expand", *t, "--root", root, "--top-seed", str(d["expand_top_seed"]),
                   "--max", str(d["rerank_max"]), "--rerank", str(d["rerank_n"])],
        "pack": [se, "pack", *q["pack_slugs"], "--root", root],
    }


def node_command(node, cli, mode, pycmd):
    """Python 인자 → Node `--once` 계약. search 는 `search.py --files …` → `--once search …`,
    expand/rerank/pack 은 서브커맨드 이름이 이미 pycmd[1] 에 있다."""
    if mode == "search":
        return [node, cli, "--once", "search", *pycmd[2:]]
    return [node, cli, "--once", *pycmd[1:]]


def load_gen_expected():
    p = os.path.join(FIXTURES, "gen-expected.py")
    spec = importlib.util.spec_from_file_location("gen_expected", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check_commands_match(spec):
    """픽스처 질의 전건에 대해 py_commands == gen-expected.commands 인지 확인(정의 재사용 보증)."""
    ge = load_gen_expected()
    d = spec["defaults"]
    for q in spec["queries"]:
        a, b = py_commands(q, d, FIX_VAULT), ge.commands(q, d)
        if a != b:
            print(f"SETUP ERROR: command definition drift for {q['id']}\n  parity.py    : {a}\n  gen-expected : {b}")
            sys.exit(2)


# ---------------------------------------------------------------- 실행
def run(cmd):
    """(rc, stdout bytes, stderr bytes). 예외는 rc=-1 + 메시지로 흡수(스레드에서 안전)."""
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT, cwd=REPO)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, b"", f"timeout after {TIMEOUT}s".encode()
    except OSError as e:
        return -1, b"", str(e).encode()


def run_all(jobs, workers):
    """jobs: {key: cmd} → {key: (rc, out, err)}. 병렬 실행, 결과는 키로 접근(순서 결정적)."""
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(run, cmd): key for key, cmd in jobs.items()}
        for f in concurrent.futures.as_completed(futs):
            results[futs[f]] = f.result()
    return results


# ---------------------------------------------------------------- 비교
def dec(b):
    return b.decode("utf-8", errors="replace")


def unified(a, b, na, nb, limit):
    lines = list(difflib.unified_diff(dec(a).splitlines(keepends=True), dec(b).splitlines(keepends=True),
                                      fromfile=na, tofile=nb, n=2))
    if limit and len(lines) > limit:
        lines = lines[:limit] + [f"... ({len(lines) - limit} more diff lines; use --full-diff)\n"]
    return "".join(l if l.endswith("\n") else l + "\n" for l in lines)


def parse_rerank(raw):
    """rerank 출력 → ("rows", [(tier, score_str, slug, type)]) | ("msg", text) | ("error", reason)."""
    text = dec(raw)
    if not text.endswith("\n"):
        return "error", "output does not end with a single \\n"
    if "\r" in text:
        return "error", "output contains \\r"
    body = text[:-1]
    if body.startswith("no lexical seed for:"):
        return "msg", text
    rows = []
    for i, line in enumerate(body.split("\n"), 1):
        parts = line.split("\t")
        if len(parts) != 4:
            return "error", f"line {i}: expected 4 tab-separated fields, got {len(parts)}: {line!r}"
        # 점수 열은 Python `f"{x:.1f}"` 형식(부호·정수·소수 1자리)이어야 하며 유한값이어야 한다.
        # `float("nan")` 은 성공하고 `abs(py-nan) > tol` 이 False 라 NaN 이 통과하는 허점(코덱스 P1 리뷰 #3)을 막는다.
        if not re.fullmatch(r"-?\d+\.\d", parts[1]) or not math.isfinite(float(parts[1])):
            return "error", f"line {i}: score not a finite .1f number: {parts[1]!r}"
        rows.append(tuple(parts))
    return "rows", rows


def compare_rerank(py, nd):
    """(ok, detail). tier·slug·type·행수·순서 정확 일치, score |Δ|≤SCORE_TOL."""
    kp, vp = parse_rerank(py)
    kn, vn = parse_rerank(nd)
    if kp == "error":
        return False, f"python output unparsable: {vp}"
    if kn == "error":
        return False, f"node output unparsable: {vn}"
    if kp != kn:
        return False, f"python is {kp} but node is {kn}\n" + unified(py, nd, "python", "node", 40)
    if kp == "msg":
        return (vp == vn), ("" if vp == vn else unified(py, nd, "python", "node", 10))
    problems = []
    if len(vp) != len(vn):
        problems.append(f"row count python={len(vp)} node={len(vn)}")
    for i, (rp, rn) in enumerate(zip(vp, vn), 1):
        if (rp[0], rp[2], rp[3]) != (rn[0], rn[2], rn[3]):
            problems.append(f"row {i}: tier/slug/type python={rp[0]}/{rp[2]}/{rp[3]} node={rn[0]}/{rn[2]}/{rn[3]}")
        elif abs(float(rp[1]) - float(rn[1])) > SCORE_TOL:
            problems.append(f"row {i} ({rp[2]}): score python={rp[1]} node={rn[1]} |Δ|>{SCORE_TOL}")
    if len(vp) != len(vn):
        extra = vp[len(vn):] if len(vp) > len(vn) else vn[len(vp):]
        who = "python-only" if len(vp) > len(vn) else "node-only"
        problems.append(f"{who} rows: " + ", ".join(r[2] for r in extra))
    return (not problems), "\n".join(problems)


def compare(mode, py_res, nd_res, full_diff):
    """(status, detail). status ∈ PASS | FAIL."""
    prc, pout, perr = py_res
    nrc, nout, nerr = nd_res
    if prc != 0:
        return "FAIL", f"python exit {prc}: {dec(perr).strip().splitlines()[-1:] or ['(no stderr)']}"
    if nrc != 0:
        first = (dec(nerr).strip().splitlines() or ["(no stderr)"])[0]
        return "FAIL", f"node exit {nrc}: {first}"
    if mode == "rerank":
        ok, detail = compare_rerank(pout, nout)
        return ("PASS" if ok else "FAIL"), detail
    if pout == nout:
        return "PASS", ""
    return "FAIL", unified(pout, nout, "python", "node", 0 if full_diff else 60)


# ---------------------------------------------------------------- 드라이버
def setup_checks(node_cli):
    for s in ("scope-expand.py", "search.py"):
        if not os.path.isfile(os.path.join(SCRIPTS, s)):
            print(f"SETUP ERROR: python script missing: {os.path.join(SCRIPTS, s)}")
            sys.exit(2)
    node = shutil.which("node")
    if not node:
        print("SETUP ERROR: `node` not found on PATH (need Node >= 20)")
        sys.exit(2)
    if not os.path.isfile(node_cli):
        print(f"SETUP ERROR: node build missing: {node_cli}\n"
              f"  build it first:  cd {os.path.relpath(PKG, REPO)} && npm ci && npm run build")
        sys.exit(2)
    return node


def print_table(ids, results, with_golden):
    """results[(id, mode)] = (status, golden) — golden ∈ 'OK' | 'DRIFT' | '-'"""
    head = f"{'query':<6}" + "".join(f"{m:<18}" for m in MODES)
    print(head)
    print("-" * len(head))
    for qid in ids:
        cells = []
        for m in MODES:
            st, g = results[(qid, m)]
            cells.append(f"{st}/{g}" if with_golden else st)
        print(f"{qid:<6}" + "".join(f"{c:<18}" for c in cells))
    if with_golden:
        print("cell = parity/golden  (parity: Python vs Node · golden: Python vs expected/*.txt)")


def run_fixtures(node, node_cli, workers, full_diff):
    with open(os.path.join(FIXTURES, "queries.json"), encoding="utf-8") as fh:
        spec = json.load(fh)
    check_commands_match(spec)
    d = spec["defaults"]
    queries = spec["queries"]

    jobs = {}
    for q in queries:
        for mode, pycmd in py_commands(q, d, FIX_VAULT).items():
            jobs[(q["id"], mode, "py")] = [PY, *pycmd]
            jobs[(q["id"], mode, "node")] = node_command(node, node_cli, mode, pycmd)
    t0 = time.time()
    res = run_all(jobs, workers)
    elapsed = time.time() - t0

    table, fails, drift, details = {}, 0, 0, []
    for q in queries:
        for mode in MODES:
            key = (q["id"], mode)
            st, detail = compare(mode, res[(*key, "py")], res[(*key, "node")], full_diff)
            # 골든 드리프트: Python 출력 vs 커밋된 expected
            gpath = os.path.join(EXPECTED, f"{q['id']}-{mode}.txt")
            prc, pout, _ = res[(*key, "py")]
            try:
                with open(gpath, "rb") as fh:
                    golden = fh.read()
                g = "OK" if (prc == 0 and golden == pout) else "DRIFT"
                gdetail = "" if g == "OK" else unified(golden, pout, "expected", "python", 0 if full_diff else 40)
            except OSError:
                g, gdetail = "DRIFT", f"expected file missing: {gpath}"
            table[key] = (st, g)
            if st != "PASS":
                fails += 1
                details.append(f"--- FAIL {q['id']} {mode}  [{q.get('case', '')}]\n{detail}")
            if g != "OK":
                drift += 1
                details.append(f"--- GOLDEN DRIFT {q['id']} {mode}\n{gdetail}")

    print(f"fixture parity: {len(queries)} queries x {len(MODES)} modes = {len(jobs)} runs, "
          f"{workers} workers, {elapsed:.1f}s\n")
    print_table([q["id"] for q in queries], table, with_golden=True)
    if details:
        print("\n" + "\n".join(details))
    print(f"\nparity FAIL: {fails}/{len(table)}   golden DRIFT: {drift}/{len(table)}")
    return fails + drift


def run_vault(node, node_cli, vault, qfile, workers, full_diff):
    """실볼트 패리티(P1-43). 성공 시 볼트 콘텐츠는 절대 출력하지 않는다(개수만).
    실패 시 diff 를 출력한다 — 이 모드는 로컬 전용(CI 에는 볼트가 없어 스킵)이므로 허용."""
    vault = os.path.abspath(vault)
    if not os.path.isdir(vault):
        print(f"SKIP: vault not found: {vault}  (exit 0)")
        return 0
    with open(os.path.join(FIXTURES, "queries.json"), encoding="utf-8") as fh:
        d = json.load(fh)["defaults"]
    queries = DEFAULT_VAULT_QUERIES
    if qfile:
        with open(qfile, encoding="utf-8") as fh:
            vspec = json.load(fh)
        queries = vspec["queries"]
        d = {**d, **vspec.get("defaults", {})}

    # 1) pack slug 유도: Python expand 상위 5 slug (pack_slugs 가 명시된 질의는 그대로)
    need = [q for q in queries if not q.get("pack_slugs")]
    pre = {q["id"]: [PY, *py_commands({**q, "pack_slugs": []}, d, vault)["expand"]] for q in need}
    pre_res = run_all(pre, workers)
    for q in need:
        rc, out, _ = pre_res[q["id"]]
        slugs = []
        if rc == 0:
            for line in dec(out).split("\n"):
                parts = line.split("\t")
                if len(parts) == 4:
                    slugs.append(parts[2])
        q["pack_slugs"] = slugs[:5] or ["nonexistent-slug"]   # 미매치 질의는 (없음) 경로를 비교

    # 2) 4모드 × Python/Node
    jobs = {}
    for q in queries:
        for mode, pycmd in py_commands(q, d, vault).items():
            jobs[(q["id"], mode, "py")] = [PY, *pycmd]
            jobs[(q["id"], mode, "node")] = node_command(node, node_cli, mode, pycmd)
    t0 = time.time()
    res = run_all(jobs, workers)
    elapsed = time.time() - t0

    table, fails, details = {}, 0, []
    for q in queries:
        for mode in MODES:
            key = (q["id"], mode)
            st, detail = compare(mode, res[(*key, "py")], res[(*key, "node")], full_diff)
            table[key] = (st, "-")
            if st != "PASS":
                fails += 1
                details.append(f"--- FAIL {q['id']} {mode}  terms={q['terms']}\n{detail}")
    print(f"vault parity: {vault}\n  {len(queries)} queries x {len(MODES)} modes = {len(jobs)} runs, "
          f"{workers} workers, {elapsed:.1f}s\n")
    print_table([q["id"] for q in queries], table, with_golden=False)
    if details:
        print("\n" + "\n".join(details))
    # 반복 실행 간 출력 동일성을 증명할 digest(콘텐츠 비노출) — codex P1 2차 리뷰 MAJOR-2.
    # 질의·모드 순서로 stdout 바이트를 이어 붙여 SHA-256. Python 측·Node 측 각각 기록한다.
    hp, hn = hashlib.sha256(), hashlib.sha256()
    for q in queries:
        for mode in MODES:
            hp.update(res[(q["id"], mode, "py")][1])
            hn.update(res[(q["id"], mode, "node")][1])
    print(f"digest python={hp.hexdigest()[:16]} node={hn.hexdigest()[:16]}  (질의·모드 순 stdout 연결 SHA-256, 앞 16자)")
    print(f"\nparity FAIL: {fails}/{len(table)}")
    return fails


def main():
    ap = argparse.ArgumentParser(description="Python 정본 vs Node 포팅 패리티 테스트 (DESIGN §7)")
    ap.add_argument("--node", default=DEFAULT_CLI, metavar="CLI_JS",
                    help="Node CLI 경로 (기본: tools/llmwiki-mcp/dist/cli.js)")
    ap.add_argument("--vault", metavar="PATH",
                    help="실볼트 모드: 이 볼트에 대표 질의 5개를 실행해 비교. 경로 없으면 스킵(exit 0)")
    ap.add_argument("--vault-queries", metavar="FILE",
                    help="--vault 질의 JSON (queries.json 과 같은 형태; pack_slugs 생략 시 expand 상위 5 slug)")
    ap.add_argument("--jobs", type=int, default=(os.cpu_count() or 4), metavar="N",
                    help="병렬 워커 수 (기본: CPU 수)")
    ap.add_argument("--full-diff", action="store_true", help="diff 출력을 자르지 않음")
    a = ap.parse_args()

    node_cli = os.path.abspath(a.node)
    node = setup_checks(node_cli)
    workers = max(1, a.jobs)

    if a.vault:
        n = run_vault(node, node_cli, a.vault, a.vault_queries, workers, a.full_diff)
    else:
        n = run_fixtures(node, node_cli, workers, a.full_diff)
    print("PARITY ALL PASS" if n == 0 else f"PARITY FAIL ({n})")
    sys.exit(0 if n == 0 else 1)


if __name__ == "__main__":
    main()

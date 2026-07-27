#!/usr/bin/env python3
"""LLM Wiki 비용대비효과 리포트 (deterministic — 0 LLM tokens).

metrics/ingest-cost.csv 를 읽어 문서당 토큰 효율·모델가중 비용·모델별 비교를 낸다.

효율 지표:
  tok/page  = tokens / (l3_new + l3_merged)   — 위키 페이지 1장당 토큰
  tok/100ln = tokens / source_lines * 100      — 소스 100줄당 토큰(소스 크기 정규화)
  wcost     = tokens * MODEL_PRICE[model]       — 모델 가격 가중 비용단위(상대)
  waste%    = wasted / (tokens+wasted)

MODEL_PRICE (출력토큰 상대단가, 근사): opus 5 · sonnet 1 · haiku 0.25
→ 같은 토큰이라도 opus는 sonnet의 5배 비용. 모델 라우팅 효과를 wcost가 잡는다.

Usage: cost-report.py [csv] [--json] [--by-model]
"""
import csv, sys, json, os

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT = os.path.join(os.path.dirname(__file__), "ingest-cost.csv")
MODEL_PRICE = {"opus": 5.0, "sonnet": 1.0, "haiku": 0.25}


def num(x, cast=int, d=0):
    try:
        return cast(x)
    except (ValueError, TypeError):
        return d


def load(path):
    rows = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            tok = num(r["tokens"]); wasted = num(r.get("wasted_tokens", 0))
            lines = num(r["source_lines"]); pages = num(r["l3_new"]) + num(r["l3_merged"])
            model = (r.get("model") or "opus").strip()
            price = MODEL_PRICE.get(model, 5.0)
            rows.append({
                "source": r["source_slug"], "model": model, "lines": lines,
                "tokens": tok, "wasted": wasted, "pages": pages,
                "wcost": round(tok * price),
                "tok_per_page": round(tok / pages) if pages else None,
                "tok_per_100ln": round(tok / lines * 100) if lines else None,
                "wcost_per_100ln": round(tok * price / lines * 100) if lines else None,
                "waste_pct": round(100 * wasted / (tok + wasted), 1) if (tok + wasted) else 0.0,
            })
    return rows


def agg(rows):
    tok = sum(r["tokens"] for r in rows); lines = sum(r["lines"] for r in rows)
    pages = sum(r["pages"] for r in rows); wcost = sum(r["wcost"] for r in rows)
    wasted = sum(r["wasted"] for r in rows)
    return {
        "n": len(rows), "tokens": tok, "wasted": wasted, "pages": pages,
        "lines": lines, "wcost": wcost,
        "tok_per_page": round(tok / pages) if pages else None,
        "tok_per_100ln": round(tok / lines * 100) if lines else None,
        "wcost_per_100ln": round(wcost / lines * 100) if lines else None,
        "waste_pct": round(100 * wasted / (tok + wasted), 1) if (tok + wasted) else 0.0,
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv[1:]
    by_model = "--by-model" in sys.argv[1:]
    path = args[0] if args else DEFAULT
    if not os.path.exists(path):
        print(f"no ledger: {path}"); return
    rows = load(path)

    if as_json:
        out = {"rows": rows, "summary": agg(rows)}
        if by_model:
            models = sorted({r["model"] for r in rows})
            out["by_model"] = {m: agg([r for r in rows if r["model"] == m]) for m in models}
        print(json.dumps(out, ensure_ascii=False, indent=2)); return

    print(f"{'source':32} {'model':7} {'lines':>5} {'tokens':>8} {'pg':>3} {'tok/pg':>7} {'tok/100ln':>9} {'wcost':>9} {'wc/100ln':>8}")
    print("-" * 100)
    for r in rows:
        print(f"{r['source']:32} {r['model']:7} {r['lines']:>5} {r['tokens']:>8} {r['pages']:>3} "
              f"{str(r['tok_per_page'] or '-'):>7} {str(r['tok_per_100ln'] or '-'):>9} "
              f"{r['wcost']:>9,} {str(r['wcost_per_100ln'] or '-'):>8}")
    print("-" * 100)
    s = agg(rows)
    print(f"총 {s['n']}건 · {s['tokens']:,} 토큰 · wcost {s['wcost']:,} · {s['pages']} 페이지 · "
          f"낭비 {s['waste_pct']}% · 평균 페이지당 {s['tok_per_page']:,} tok · 소스100줄당 {s['tok_per_100ln']:,} tok / wcost {s['wcost_per_100ln']:,}")

    if by_model:
        print("\n== 모델별 (before/after 비교) ==")
        for m in sorted({r["model"] for r in rows}):
            a = agg([r for r in rows if r["model"] == m])
            print(f"  [{m:7}] {a['n']}건 · 소스100줄당 tok {a['tok_per_100ln']:,} / wcost {a['wcost_per_100ln']:,} · 페이지당 {a['tok_per_page']:,} tok")


if __name__ == "__main__":
    main()

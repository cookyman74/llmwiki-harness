#!/usr/bin/env python3
"""크로스플랫폼 스모크 테스트 — 결정적 스크립트가 모든 OS(ubuntu/macos/windows)에서
작동하는지 검증. CI 매트릭스 + 로컬(빈 clone)에서 `python tests/smoke.py`로 실행.

seed 세팅 → 각 스크립트 실행·검증 → 임시 콘텐츠로 감지 확인 → cleanup. 실패 시 exit 1.

**안전 가드:** 이미 콘텐츠가 있는 볼트(운영 중)에서는 실행 거부한다 — seed 복사가
index.md/log.md/home-moc를 덮어쓰기 때문. 빈 clone/CI 체크아웃에서만 돈다.
"""
import os
import shutil
import subprocess
import sys

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable or "python"
S = ".claude/skills"
fails = []


def run(rel, *args):
    r = subprocess.run([PY, os.path.join(ROOT, rel), ROOT, *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def run_args(rel, *args):
    r = subprocess.run([PY, os.path.join(ROOT, rel), *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "")


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + ("" if cond else f"  — {detail[:200]}"))
    if not cond:
        fails.append(name)


def main():
    os.chdir(ROOT)
    l3 = os.path.join("wiki", "L3-semantic")
    if os.path.isdir(l3) and any(f.endswith(".md") for f in os.listdir(l3)):
        print("ABORT: 위키에 콘텐츠가 있음 — 스모크는 빈 clone/CI에서만 실행 "
              "(seed 복사가 index/log/home-moc를 덮어씀).")
        sys.exit(2)

    # method C seed 세팅
    for f in ("index.md", "log.md"):
        shutil.copy(os.path.join("templates", "seeds", f), f)
    shutil.copy(os.path.join("templates", "seeds", "home-moc.md"),
                os.path.join("wiki", "moc", "home-moc.md"))

    # 빈 위키에서 결정적 스크립트
    rc, out = run(f"{S}/wiki-lint/scripts/validate-pages.py")
    check("validate (empty)", rc == 0, out)
    rc, out = run(f"{S}/wiki-lint/scripts/link-audit.py")
    check("link-audit", "orphans" in out, out)
    rc, out = run(f"{S}/wiki-lint/scripts/lint-due.py", "3")
    check("lint-due (BACKLOG)", "BACKLOG:" in out, out)
    rc, out = run(f"{S}/wiki-lint/scripts/ingest-status.py")
    check("ingest-status", "pending:" in out, out)
    rc, out = run(f"{S}/wiki-ingest/scripts/concept-index.py")
    check("concept-index", rc == 0, out)
    rc, out = run(f"{S}/wiki-lint/scripts/wiki-status-check.py")
    check("sessionstart json", out.strip().startswith("{"), out)

    rc, out = run_args(f"{S}/wiki-consolidate/scripts/confidence.py", "--count", "2")
    check("confidence (2→0.85)", out.strip() == "0.85", out)
    rc, out = run_args(f"{S}/wiki-lint/scripts/decay.py", "--class", "transient",
                       "--last", "2026-01-01", "--today", "2026-07-27")
    check("decay (faded)", "faded" in out, out)

    # 콘텐츠 감지
    os.makedirs("raw", exist_ok=True)
    with open(os.path.join("raw", "_smoke.md"), "w", encoding="utf-8") as fh:
        fh.write("# smoke source\n")
    rc, out = run(f"{S}/wiki-lint/scripts/ingest-status.py")
    check("pending 감지", "pending: 0" not in out and "pending:" in out, out)

    with open(os.path.join(l3, "_smoke.md"), "w", encoding="utf-8") as fh:
        fh.write("---\ntype: concept\n---\nbody\n</content>\n")
    rc, out = run(f"{S}/wiki-lint/scripts/validate-pages.py")
    check("stray-tag 감지", rc == 1 and "stray-tag" in out, out)

    # cleanup (CI 체크아웃은 휘발이지만 로컬 clone 대비)
    for p in ("index.md", "log.md", os.path.join("wiki", "moc", "home-moc.md"),
              os.path.join("raw", "_smoke.md"), os.path.join(l3, "_smoke.md")):
        try:
            os.remove(p)
        except OSError:
            pass

    print("\n" + ("ALL PASS ✅" if not fails else "FAILED ❌: " + ", ".join(fails)))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

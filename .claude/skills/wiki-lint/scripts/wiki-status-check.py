#!/usr/bin/env python3
"""SessionStart 훅 (deterministic — 0 LLM 토큰). wiki-status-check.sh의 python 포팅.

세션 시작 시 1회, 위키 상태 점검 결과를 additionalContext로 주입한다(모델용). 아무것도
안 걸리면 {} 출력(조용). lint-due·ingest-status·validate-pages를 python 서브프로세스로 호출.

Cross-platform: bash·grep·jq 불필요. python3만 있으면 Windows/Mac/Linux 동일 작동.
"""
import json
import os
import re
import subprocess
import sys

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

BACKLOG_THRESH = 5    # 마지막 lint 이후 인제스트가 이만큼이면 lint 권고
MOC_THRESH = 12       # 주제 MoC(home 제외)가 이만큼 넘으면 cartographer 권고

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))  # → 볼트 루트
PY = sys.executable or "python3"


def run(script, *args):
    try:
        r = subprocess.run([PY, os.path.join(HERE, script), ROOT, *args],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=60)
        return r.stdout
    except Exception:
        return ""


def run_skill(skill, script, *args):
    """다른 스킬의 스크립트를 호출한다 (예: meeting-minutes/pending-recordings.py)."""
    path = os.path.join(ROOT, ".claude", "skills", skill, "scripts", script)
    if not os.path.isfile(path):
        return ""
    try:
        r = subprocess.run([PY, path, ROOT, *args],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=60)
        return r.stdout
    except Exception:
        return ""


def main():
    msgs = []

    # lint 경과 · 백로그 · L1
    due = run("lint-due.py", "3")
    status = (due.splitlines() or [""])[0]
    def field(name, default="0"):
        m = re.search(rf"^{name}:(\S+)", due, re.MULTILINE)
        return m.group(1) if m else default
    l1 = int(field("L1") or 0)
    backlog = int(field("BACKLOG") or 0)

    if status.startswith("DUE "):
        msgs.append(f"마지막 위키 lint로부터 {status[4:]}일 경과 — `wiki-ops`로 lint 권장(망각·신뢰도·통합 점검).")
    if backlog >= BACKLOG_THRESH:
        msgs.append(f"마지막 lint 이후 인제스트 {backlog}건 — 병합·신뢰도·관계가 밀려 있음. `wiki-ops`로 lint 배치 권장.")
    if l1 > 0:
        msgs.append(f"L1-working에 미압축 페이지 {l1}장 — 세션 마무리 시 `wiki-consolidate`로 L1→L2 압축 권장.")

    # 미인제스트 raw 소스
    ing = run("ingest-status.py")
    mp = re.search(r"pending:\s*(\d+)", ing)
    pending = int(mp.group(1)) if mp else 0
    if pending > 0:
        msgs.append(f"raw/에 미인제스트 소스 {pending}개 — `wiki-ops`로 인제스트 권장.")

    # 미처리 녹음 (raw/assets/ 오디오 → 전사문 → 회의록)
    rec = run_skill("meeting-minutes", "pending-recordings.py", "--json")
    try:
        rj = json.loads(rec) if rec.strip() else {}
    except Exception:
        rj = {}
    rec_new = int(rj.get("new") or 0)
    rec_tr = int(rj.get("transcribed_only") or 0)
    if rec_tr > 0:
        msgs.append(f"전사만 끝난 녹음 {rec_tr}건 — 회의록 미작성. `meeting-minutes`로 작성 권장(전사 재실행 불필요).")
    if rec_new > 0:
        names = [r["audio"] for r in rj.get("rows", []) if r.get("state") == "NEW"][:3]
        hint = ", ".join(names) + ("…" if rec_new > 3 else "")
        msgs.append(f"미처리 녹음 {rec_new}건 ({hint}) — 회의록 미작성. "
                    f"`meeting-minutes`로 처리 권장. **백엔드(로컬/외부)는 회의 성격에 따라 사람이 판정**하므로 "
                    f"자동 전사하지 않는다 — 사용자에게 회의 성격을 물어볼 것.")

    # 페이지 포맷 오염
    val = run("validate-pages.py", "--json")
    mv = re.search(r'"issue_count":\s*(\d+)', val)
    fmt_issues = int(mv.group(1)) if mv else 0
    if fmt_issues > 0:
        msgs.append(f"페이지 포맷 위반 {fmt_issues}건 감지(stray 태그·frontmatter 등) — `validate-pages.py`로 확인 후 정리 권장.")

    # MoC 남발 (home 제외 주제 MoC 수)
    mocdir = os.path.join(ROOT, "wiki", "moc")
    if os.path.isdir(mocdir):
        moc_n = sum(1 for f in os.listdir(mocdir)
                    if f.endswith(".md") and f != "home-moc.md")
        if moc_n > MOC_THRESH:
            msgs.append(f"주제 MoC {moc_n}개 — home-moc 비대·얇은 MoC 가능. `wiki-cartographer`로 그룹 재구성 검토 권장.")

    # 미해결 확인 큐
    ncq = os.path.join(ROOT, "_workspace", "needs-confirm.md")
    if os.path.isfile(ncq):
        try:
            with open(ncq, encoding="utf-8-sig", errors="replace") as fh:
                nc = sum(1 for l in fh if l.startswith("- [ ]"))
        except OSError:
            nc = 0
        if nc > 0:
            msgs.append(f"확인 대기 항목 {nc}건 (`_workspace/needs-confirm.md`) — 사람 판단 필요(동일성·상충 등). 확인 후 체크.")

    if not msgs:
        print("{}")
        return
    ctx = "[위키 자동 점검] " + " ".join(msgs)
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                             "additionalContext": ctx}}, ensure_ascii=False))


if __name__ == "__main__":
    # 어떤 실패에도 유효한 JSON({})을 내보낸다 — 훅 명령이 셸 폴백(|| echo) 없이도
    # 안전하도록(Windows cmd/PowerShell엔 그 구문이 없음).
    try:
        main()
    except Exception:
        print("{}")

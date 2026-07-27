#!/usr/bin/env bash
# SessionStart hook: nudge when a wiki lint is overdue (>3 days) or L1-working
# holds uncompressed pages. Emits SessionStart additionalContext (model-facing,
# once per session) — NOT a Stop hook, which would fire every turn.
# Reads lint-due.sh; stays silent (empty JSON) when nothing is due.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../../../.."   # scripts -> wiki-lint -> skills -> .claude -> vault root
root="$(cd "$root" && pwd)"

BACKLOG_THRESH=5   # 마지막 lint 이후 인제스트가 이만큼 쌓이면 lint 권고

due_out="$(bash "$here/lint-due.sh" "$root" 3 2>/dev/null || true)"
status_line="$(printf '%s\n' "$due_out" | head -1)"
l1_line="$(printf '%s\n' "$due_out" | grep -E '^L1:' || echo 'L1:0')"
l1="${l1_line#L1:}"
backlog_line="$(printf '%s\n' "$due_out" | grep -E '^BACKLOG:' || echo 'BACKLOG:0')"
backlog="${backlog_line#BACKLOG:}"

msgs=()
case "$status_line" in
  DUE*) days="${status_line#DUE }"; msgs+=("마지막 위키 lint로부터 ${days}일 경과 — \`wiki-ops\`로 lint 권장(망각·신뢰도·통합 점검).") ;;
  NEVER) : ;;  # fresh vault, no lint yet — stay quiet
esac
# 백로그 기반 lint 권고 (시간과 별개 — lazy가 미룬 병합이 쌓임)
if [ "${backlog:-0}" -ge "$BACKLOG_THRESH" ]; then
  msgs+=("마지막 lint 이후 인제스트 ${backlog}건 — 병합·신뢰도·관계가 밀려 있음. \`wiki-ops\`로 lint 배치 권장.")
fi
if [ "${l1:-0}" -gt 0 ]; then
  msgs+=("L1-working에 미압축 페이지 ${l1}장 — 세션 마무리 시 \`wiki-consolidate\`로 L1→L2 압축 권장.")
fi

# un-ingested raw sources (pending stamp)
pending="$(bash "$here/ingest-status.sh" "$root" 2>/dev/null | grep -oE 'pending: [0-9]+' | grep -oE '[0-9]+' || echo 0)"
if [ "${pending:-0}" -gt 0 ]; then
  msgs+=("raw/에 미인제스트 소스 ${pending}개 — \`wiki-ops\`로 인제스트 권장.")
fi

# 페이지 포맷 오염 (stray 태그·frontmatter 결함 등) — 조기 경보
fmt_issues="$(python3 "$here/validate-pages.py" "$root" --json 2>/dev/null | grep -oE '"issue_count": *[0-9]+' | grep -oE '[0-9]+' | head -1)"
fmt_issues="${fmt_issues:-0}"
if [ "${fmt_issues:-0}" -gt 0 ]; then
  msgs+=("페이지 포맷 위반 ${fmt_issues}건 감지(stray 태그·frontmatter 등) — \`validate-pages.py\`로 확인 후 정리 권장.")
fi

if [ "${#msgs[@]}" -eq 0 ]; then
  echo '{}'
  exit 0
fi

# join messages and emit as SessionStart additionalContext (JSON-safe via python)
printf '%s\n' "${msgs[@]}" | python3 -c '
import sys, json
ctx = "[위키 자동 점검] " + " ".join(l.strip() for l in sys.stdin if l.strip())
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ctx}}, ensure_ascii=False))
'

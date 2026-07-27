#!/usr/bin/env bash
# Is a wiki lint overdue? (deterministic — used by the session-end Stop hook)
# "Overdue" = >N days since the last `## [DATE] lint |` entry in log.md.
# Also reports whether L1-working still holds uncompressed pages.
# Usage: lint-due.sh [vault_root] [threshold_days]   (defaults: . 3)
# Prints one of: DUE <days> | OK <days> | NEVER   then L1:<count>
set -uo pipefail
root="${1:-.}"
thresh="${2:-3}"
log="$root/log.md"

last=""
if [ -f "$log" ]; then
  last=$(grep -oE '^## \[[0-9]{4}-[0-9]{2}-[0-9]{2}\] lint' "$log" 2>/dev/null | tail -1 \
         | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
fi

# count non-placeholder pages sitting in L1-working
l1=0
if [ -d "$root/wiki/L1-working" ]; then
  l1=$(find "$root/wiki/L1-working" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
fi

# ingests since the last lint (backlog of deferred merges). Reset on each lint;
# final count = ingests after the last lint (or all ingests if never linted).
backlog=0
if [ -f "$log" ]; then
  # 날짜 헤딩만 매칭 (last 추출과 동일한 엄격도 — [draft] 같은 비날짜 헤딩 오카운트 방지)
  backlog=$(awk '/^## \[[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\] lint/{c=0; next} /^## \[[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\] ingest/{c++} END{print c+0}' "$log")
fi

if [ -z "$last" ]; then
  echo "NEVER"
  echo "L1:$l1"
  echo "BACKLOG:$backlog"
  exit 0
fi

# days between last lint and today (portable: python3 for date math)
days=$(python3 - "$last" <<'PY'
import sys
from datetime import date
try:
    last = date.fromisoformat(sys.argv[1]); print((date.today() - last).days)
except Exception:
    print("")   # 파싱 실패 시 빈 값 → 아래에서 0으로 방어
PY
)
# days가 비었거나 숫자 아니면 0으로 (정수 비교 crash·set -u 중단 방지)
case "$days" in ''|*[!0-9]*) days=0 ;; esac

if [ "$days" -gt "$thresh" ]; then
  echo "DUE $days"
else
  echo "OK $days"
fi
echo "L1:$l1"
echo "BACKLOG:$backlog"

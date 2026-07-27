#!/usr/bin/env python3
"""PostToolUse 훅: Write/Edit로 건드린 .md의 frontmatter `updated:`를 오늘로 스탬프.
jq/awk/date(Unix) 대신 python으로 — cross-platform. stdin으로 훅 JSON을 받는다.
본문/다른 필드는 무변경. `updated:` 필드가 없으면 아무것도 안 함(추가하지 않음).
"""
import json
import re
import sys
from datetime import date

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    ti = data.get("tool_input") or {}
    tr = data.get("tool_response") or {}
    f = ti.get("file_path") or tr.get("filePath")
    if not f or not f.endswith(".md"):
        return
    try:
        with open(f, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return
    today = date.today().isoformat()
    for i, l in enumerate(lines):
        if re.match(r"^updated:", l):
            new = f"updated: {today}\n"
            if lines[i] != new:
                lines[i] = new
                try:
                    with open(f, "w", encoding="utf-8", errors="replace") as fh:
                        fh.writelines(lines)
                except OSError:
                    pass
            return  # 첫 updated: 만


if __name__ == "__main__":
    main()

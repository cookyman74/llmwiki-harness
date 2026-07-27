#!/usr/bin/env python3
"""기존 L3/L4 개념 카탈로그 (deterministic — 0 LLM 토큰). concept-index.sh의 python 포팅.

인제스트 시 페이지 본문을 Read하지 말고 이 한 줄 출력만 보고 신규/기존을 가른다.
각 줄: slug | title | aliases | confidence   (frontmatter만 읽음)

Usage: concept-index.py [vault_root] [filter ...]
  filter: (선택) 하나 이상의 키워드. 주면 slug|title|aliases|confidence 줄에 그 키워드가
          (대소문자 무시·리터럴 부분문자열) 포함된 줄만 출력 — 위키 스케일 시 카탈로그 바운드.
          예) concept-index.py . rag vector  → rag/vector 관련만. (리터럴이라 c++·node.js 안전)
  요약은 stderr. python `in` 매칭이라 정규식 특수문자 걱정 없음.
"""
import os
import re
import sys

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def read_fm(path):
    # utf-8-sig: UTF-8 BOM 대응 (Windows 저장 파일)
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        lines = fh.readlines()
    if not lines or lines[0].strip() != "---":
        return {}
    fm = {}
    for l in lines[1:]:
        if l.strip() == "---":
            break
        m = re.match(r"^([A-Za-z_]\w*):\s*(.*)$", l)
        if m:
            fm[m.group(1)] = m.group(2).strip()  # .strip() → CRLF의 \r 제거
    return fm


def main():
    args = sys.argv[1:]
    root = args[0] if args else "."
    filters = [f.lower() for f in args[1:]]

    lines = []
    for d in ("wiki/L3-semantic", "wiki/L4-procedural"):
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if not f.endswith(".md"):
                continue
            fm = read_fm(os.path.join(base, f))
            slug = f[:-3]
            lines.append(f"{slug} | {fm.get('title', '?')} | "
                         f"{fm.get('aliases', '[]')} | {fm.get('confidence', '?')}")

    total, shown = len(lines), 0
    for line in lines:
        if not filters or any(kw in line.lower() for kw in filters):
            print(line)
            shown += 1

    if filters:
        print(f"[concept-index] 총 {total}개 중 필터({' '.join(filters)}) 매칭 {shown}개",
              file=sys.stderr)
    else:
        print(f"[concept-index] 총 {total}개", file=sys.stderr)


if __name__ == "__main__":
    main()

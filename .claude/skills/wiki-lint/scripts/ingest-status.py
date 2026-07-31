#!/usr/bin/env python3
"""raw 소스 인제스트 상태 (deterministic — 0 LLM 토큰). ingest-status.sh의 python 포팅.

raw/*.md 맨 위 스탬프(frontmatter `ingest_status: done`)를 읽어 done/pending을 판별.
raw 본문은 immutable — 이 메타 블록만 인제스트가 쓴다.
제외: raw/assets/(이미지) · raw/notes/(데일리 스크래치 — opt-in 인제스트).

Usage: ingest-status.py [vault_root]  (default: .)
출력: DONE <date> <file> | PENDING <file>   그다음 "ingested: N   pending: M"
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


def frontmatter(path):
    """파일 맨 위 YAML frontmatter 블록(--- ... ---)만 반환. 없으면 "".

    고정 바이트(read(600)) 대신 블록 전체를 읽는다 — 긴 description 등으로
    스탬프 필드가 앞쪽 N바이트 밖에 있어도 놓치지 않기 위함. 본문은 안 읽는다
    (닫는 --- 에서 멈춤). 방어적으로 최대 200줄까지만 스캔.
    """
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        if fh.readline().strip() != "---":
            return ""  # frontmatter 없음
        out = []
        for _ in range(200):
            line = fh.readline()
            if not line or line.strip() == "---":
                # 닫는 --- 를 만났을 때만 정상 frontmatter로 인정.
                # 파일 끝(닫힘 없음)이면 본문 오파싱 방지 위해 "" 반환.
                return "".join(out) if line.strip() == "---" else ""
            out.append(line)
    return ""  # 200줄 내 닫는 --- 없음 → frontmatter 아님으로 간주


# 값 앞뒤 따옴표(선택) 허용 — `ingest_status: "done"` / `ingested: '2026-07-31'` 대응.
# ^ 앵커 유지: 스탬프는 항상 top-level 필드(중첩 아님)라 들여쓰기 매칭은 오탐만 늘림.
_RE_STATUS = re.compile(r"""^ingest_status:\s*['"]?(\w+)""", re.MULTILINE)
_RE_DATE = re.compile(r"""^ingested:\s*['"]?([0-9-]+)""", re.MULTILINE)


def stamp(path):
    """(status, ingested_date). status in done|stale|pending."""
    fm = frontmatter(path)
    m = _RE_STATUS.search(fm)
    st = m.group(1) if m else "pending"
    d = _RE_DATE.search(fm)
    return st, (d.group(1) if d else "?")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    rawdir = os.path.join(root, "raw")
    if not os.path.isdir(rawdir):
        print("no raw/ dir")
        return

    done_n = pend_n = 0
    rows = []
    for dp, dirs, files in os.walk(rawdir):
        # assets/ · notes/ 하위 제외
        parts = os.path.relpath(dp, rawdir).split(os.sep)
        if "assets" in parts or "notes" in parts:
            continue
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            st, d = stamp(p)
            rel = os.path.relpath(p, root)
            if st == "done":
                rows.append(f"DONE    {d}  {rel}")
                done_n += 1
            else:
                rows.append(f"{st.upper():8}{rel}")
                pend_n += 1
    for r in sorted(rows):
        print(r)
    print("---")
    print(f"ingested: {done_n}   pending: {pend_n}")


if __name__ == "__main__":
    main()

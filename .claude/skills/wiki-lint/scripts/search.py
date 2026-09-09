#!/usr/bin/env python3
"""위키 본문 검색 (deterministic — 0 LLM 토큰). search.sh의 python 포팅.

두 모드:
  1) line 모드(기본, 하위호환): 단일어 리터럴(대소문자 무시) 검색, 매칭 라인 출력.
     Usage: search.py "<query>" [vault_root]
     출력: <파일>:<라인번호>: <매칭 라인>
  2) --files 모드(사전스코프용): 여러 키워드를 OR로 검색해 파일별 랭킹.
     Usage: search.py --files "<term1>" ["term2" ...] [--root .] [--top N]
     출력(줄당 1파일): <distinct>/<총매치>\t<slug>\t<type>
       - 정렬: (매칭된 distinct term 수 desc, 총 매치수 desc) — 단순 매치수 길이왜곡 완화
       - score>0 파일만, --top은 상한(fill 아님, 기본 8)
       - 본문 + frontmatter aliases 검색(동의어 매칭률↑)
index.md/log.md 루트 파일은 wiki/ 밖이라 스코프 제외.
디렉터리 순회는 `dirs.sort()`로 정렬해 OS 무관 결정성 확보(v0.8.6 P0). 랭킹 규칙 무변경.
"""
import os
import re
import sys

# Windows/비UTF-8 로케일에서 한글 stdout 출력 인코딩 오류 방지 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _read(path):
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        return fh.read()


def _frontmatter(text):
    """맨 위 --- ... --- 블록만 반환(없으면 "")."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return ""
    out = []
    for line in lines[1:201]:
        if line.strip() == "---":
            return "\n".join(out)
        out.append(line)
    return ""


def _field(fm, name):
    m = re.search(rf"^{name}:\s*(.+)$", fm, re.MULTILINE)
    return m.group(1).strip() if m else ""


def files_mode(terms, root, top):
    base = os.path.join(root, "wiki")
    terms = [t.lower() for t in terms if t.strip()]
    if not terms:
        print("usage: search.py --files <term> [term ...] [--root .] [--top N]", file=sys.stderr)
        sys.exit(2)
    rows = []
    for dp, dirs, files in os.walk(base):
        dirs.sort()
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            try:
                text = _read(p)
            except OSError:
                continue
            fm = _frontmatter(text)
            # 본문 + aliases를 검색 대상으로(동의어 매칭)
            haystack = (text + "\n" + _field(fm, "aliases")).lower()
            distinct = 0
            total = 0
            for t in terms:
                c = haystack.count(t)
                if c:
                    distinct += 1
                    total += c
            if distinct == 0:
                continue
            slug = f[:-3]
            typ = _field(fm, "type") or os.path.basename(dp)
            rows.append((distinct, total, slug, typ))
    # distinct 우선, 그다음 총 매치수 — 둘 다 desc
    rows.sort(key=lambda r: (-r[0], -r[1], r[2]))
    if not rows:
        print(f"no matches for: {' '.join(terms)}")
        return
    for distinct, total, slug, typ in rows[:top]:
        print(f"{distinct}/{total}\t{slug}\t{typ}")


def line_mode(query, root):
    q = query.lower()
    base = os.path.join(root, "wiki")
    hits = 0
    for dp, dirs, files in os.walk(base):
        dirs.sort()
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            try:
                with open(p, encoding="utf-8-sig", errors="replace") as fh:
                    for i, line in enumerate(fh, 1):
                        if q in line.lower():
                            print(f"{rel}:{i}: {line.rstrip()}")
                            hits += 1
            except OSError:
                continue
    if hits == 0:
        print(f"no matches for: {query}")


def main():
    args = sys.argv[1:]
    if not args:
        print("usage: search.py <query> [vault_root]  |  search.py --files <term ...> [--root .] [--top N]", file=sys.stderr)
        sys.exit(2)

    if args[0] == "--files":
        root = "."
        top = 8
        terms = []
        i = 1
        while i < len(args):
            a = args[i]
            if a == "--root":
                root = args[i + 1]; i += 2
            elif a == "--top":
                top = int(args[i + 1]); i += 2
            else:
                terms.append(a); i += 1
        files_mode(terms, root, top)
    else:
        query = args[0]
        root = args[1] if len(args) > 1 else "."
        line_mode(query, root)


if __name__ == "__main__":
    main()

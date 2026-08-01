#!/usr/bin/env python3
"""raw 스탬프 정규화 (deterministic — 0 LLM 토큰).

인제스트 스탬프 3필드(ingested·wiki_source·ingest_status)를 frontmatter **맨 위**로
모으고 값을 정리한다. 목적:
- 가시성: 긴 description 뒤에 묻힌 스탬프를 맨 위로(Obsidian에서 완료표시 바로 보이게).
- 견고성: ingest_status 손상값(제어문자·이스케이프, 예: "\\bstale")을 정상값으로 교정.
본문·다른 frontmatter 필드는 보존(순서만 스탬프를 앞으로). **raw 본문 immutable 유지**.

Usage: normalize-stamps.py [vault_root] [--dry-run]
대상: raw/**.md (assets 제외). frontmatter 없는 파일·스탬프 없는 파일은 건너뜀.

가정(agy 리뷰): 스탬프 3필드는 **단일줄 스칼라**(위키 관례: `ingest_status: done`,
`wiki_source: [[slug]]`). 멀티라인/리스트형 스탬프는 위키에 없음(검증됨). CRLF는
값 추출 시 `.strip()`이 \\r 제거(BOM은 utf-8-sig). 값 복구는 ingest_status에만 적용.
"""
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

STAMP_KEYS = ("ingested", "wiki_source", "ingest_status")
VALID_STATUS = ("done", "stale", "pending")


def clean_status(v):
    """제어문자·이스케이프를 벗겨 의도값 복구. 복구된 게 유효하면 그 값, 아니면
    원 raw(따옴표만 제거)를 유지 — 정체불명 값을 done으로 강제하면 미인제스트를
    숨길 수 있으므로 ingest-status가 BAD로 노출하게 둔다(사람이 판단)."""
    raw = v.strip().strip("'\"")
    recovered = re.sub(r"\\[a-zA-Z]", "", re.sub(r"[\x00-\x1f]", "", raw))
    return recovered if recovered in VALID_STATUS else raw


def split_frontmatter(text):
    """(fm_lines, body) 반환. frontmatter 없으면 (None, text)."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    for i in range(1, min(len(lines), 300)):
        if lines[i].strip() == "---":
            return lines[1:i], "\n".join(lines[i + 1:])
    return None, text


def normalize(path, dry):
    text = open(path, encoding="utf-8-sig", errors="replace").read()
    fm, body = split_frontmatter(text)
    if fm is None:
        return None  # frontmatter 없음 — 건너뜀
    stamp, rest = {}, []
    for ln in fm:
        m = re.match(r"^(\w+):\s*(.*)$", ln)
        if m and m.group(1) in STAMP_KEYS:
            stamp[m.group(1)] = m.group(2)
        else:
            rest.append(ln)
    if "ingest_status" not in stamp:
        return None  # 스탬프 없음 — 인제스트 안 된 파일, 건드리지 않음
    stamp["ingest_status"] = clean_status(stamp["ingest_status"])
    # 스탬프 3필드를 맨 위로(있는 것만), 나머지 frontmatter는 원순서 유지
    top = [f"{k}: {stamp[k]}" for k in STAMP_KEYS if k in stamp]
    new_fm = "\n".join(top + rest)
    new_text = f"---\n{new_fm}\n---\n{body}"
    if new_text == text:
        return False  # 이미 정규화됨
    if not dry:
        open(path, "w", encoding="utf-8").write(new_text)
    return True


def main():
    root = "."
    dry = False
    for a in sys.argv[1:]:
        if a == "--dry-run":
            dry = True
        else:
            root = a
    rawdir = os.path.join(root, "raw")
    changed = skipped = already = 0
    for dp, _, files in os.walk(rawdir):
        if "assets" in os.path.relpath(dp, rawdir).split(os.sep):
            continue
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            r = normalize(os.path.join(dp, f), dry)
            if r is None:
                skipped += 1
            elif r:
                changed += 1
                print(f"{'DRY ' if dry else ''}정규화: {os.path.relpath(os.path.join(dp, f), root)}")
            else:
                already += 1
    print(f"---\n정규화: {changed}  이미정상: {already}  건너뜀(무FM/무스탬프): {skipped}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""페이지 포맷 검증 (deterministic — 0 LLM 토큰).

무성 오염을 조기에 잡는다. 과거 인제스터가 EOF에 stray `</content>`·`</invoke>`를
남긴 사태를 계기로 추가. lint/SessionStart에서 싸게 돌린다.

검사 항목:
  [stray-tag]   본문에 홀로 선 닫는 태그 (</content> 등) — 인제스트 아티팩트
                (코드펜스 ``` 안·frontmatter 안은 제외 — 예시 태그 오탐 방지)
  [no-frontmatter] wiki 페이지인데 맨 앞이 `---` 아님
  [no-type]     frontmatter에 `type:` 없음
  [bad-confidence] confidence 값이 0.0~1.0 float 아님 (따옴표 허용)
  [bad-source_kind] source_kind가 official|code|normal|verbal 아님 (따옴표 허용)

범위: wiki/**.md(포맷+stray) + 루트 index.md/log.md(포맷+stray) + raw/**.md(stray만).
Usage: validate-pages.py [vault_root] [--json]
종료코드: 위반 있으면 1, 없으면 0.
"""
import os, re, sys, json

STRAY_TAG = re.compile(r"^\s*</[a-zA-Z][^>]*>\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")
KINDS = {"official", "code", "normal", "verbal"}


def read_lines(path):
    # utf-8-sig: UTF-8 BOM 있으면 벗겨서 읽음 (Windows 저장 파일 대응)
    with open(path, encoding="utf-8-sig") as fh:
        return fh.readlines()


def split_frontmatter(lines):
    """(has_fm, fm_text, body_start_index). 첫 --- ... --- 블록."""
    if not lines or lines[0].strip() != "---":
        return False, "", 0
    fm = []
    for i, l in enumerate(lines[1:], start=1):
        if l.strip() == "---":
            return True, "".join(fm), i + 1
        fm.append(l)
    return False, "", 0  # 안 닫힘 → frontmatter 없음 취급


def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def fm_field(fm, key):
    m = re.search(rf"^{key}:\s*(.+)$", fm, re.MULTILINE)
    return unquote(m.group(1)) if m else None


def stray_tags(lines, body_start):
    """코드펜스·frontmatter 밖의 홀로 선 닫는 태그 줄 번호 목록."""
    out, in_fence = [], False
    for i, l in enumerate(lines, 1):
        if i <= body_start:          # frontmatter 영역 건너뜀
            continue
        if FENCE.match(l):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if STRAY_TAG.match(l):
            out.append((i, l.strip()))
    return out


def check_page(rel, path, issues, page_checks):
    lines = read_lines(path)
    has_fm, fm, body_start = split_frontmatter(lines)
    for ln, detail in stray_tags(lines, body_start):
        issues.append({"file": rel, "line": ln, "kind": "stray-tag", "detail": detail})
    if not page_checks:
        return
    if not has_fm:
        issues.append({"file": rel, "line": 1, "kind": "no-frontmatter", "detail": ""})
        return
    if not re.search(r"^type:\s*\S", fm, re.MULTILINE):
        issues.append({"file": rel, "line": 1, "kind": "no-type", "detail": ""})
    conf = fm_field(fm, "confidence")
    if conf is not None:
        try:
            v = float(conf)
            if not (0.0 <= v <= 1.0):
                raise ValueError
        except ValueError:
            issues.append({"file": rel, "line": 1, "kind": "bad-confidence", "detail": conf})
    sk = fm_field(fm, "source_kind")
    if sk is not None and sk not in KINDS:
        issues.append({"file": rel, "line": 1, "kind": "bad-source_kind", "detail": sk})


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv[1:]
    root = args[0] if args else "."
    issues = []

    for dp, _, files in os.walk(os.path.join(root, "wiki")):
        for f in files:
            if f.endswith(".md"):
                p = os.path.join(dp, f)
                check_page(os.path.relpath(p, root), p, issues, page_checks=True)
    for f in ("index.md", "log.md"):
        p = os.path.join(root, f)
        if os.path.isfile(p):
            check_page(f, p, issues, page_checks=True)
    for dp, _, files in os.walk(os.path.join(root, "raw")):
        for f in files:
            if f.endswith(".md"):
                p = os.path.join(dp, f)
                check_page(os.path.relpath(p, root), p, issues, page_checks=False)

    by_kind = {}
    for it in issues:
        by_kind[it["kind"]] = by_kind.get(it["kind"], 0) + 1

    if as_json:
        print(json.dumps({"issue_count": len(issues), "by_kind": by_kind, "issues": issues},
                         ensure_ascii=False, indent=2))
    else:
        if not issues:
            print("OK — 포맷 위반 없음")
        else:
            print(f"위반 {len(issues)}건: " + ", ".join(f"{k}×{v}" for k, v in sorted(by_kind.items())))
            for it in issues[:50]:
                print(f"  [{it['kind']}] {it['file']}:{it['line']}  {it['detail']}")
            if len(issues) > 50:
                print(f"  … 외 {len(issues)-50}건")
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()

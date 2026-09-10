#!/usr/bin/env python3
"""Python `str.lower()` ↔ JS `toLowerCase()` 차이 테이블 생성 → src/pylower-table.ts

정본은 **Python 3.12 (Unicode 15.0)** 의 lower(). Node 의 ICU 는 더 새 Unicode(예: Node 24 = 17.0)를 써서
Unicode 16/17 에 추가된 대문자(Cyrillic Ext-D U+1C89, Garay U+10D50~, Tulu-Tigalari, Latin Ext-D 일부 …)를
소문자화하지만 Python 3.12 에서는 미배정 문자라 항등이다(codex P1 2차 리뷰 BLOCKER-1). 이 스크립트는
전 코드포인트를 양쪽에서 실행해 **결과가 다른 코드포인트와 Python 결과**를 테이블로 고정한다.

Usage:  python3 scripts/gen-pylower-table.py            # src/pylower-table.ts 갱신
        python3 scripts/gen-pylower-table.py --check    # 디스크와 동일한지 검사(exit 1 = 불일치)
요구: node 가 PATH 에 있어야 함. 결과는 (Python 버전, Node/ICU 버전) 쌍에 따라 달라질 수 있으므로 헤더에 기록한다.
"""
import json
import os
import platform
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "pylower-table.ts")

JS_DUMP = r"""
const out=[];for(let cp=0;cp<0x110000;cp++){if(cp>=0xD800&&cp<=0xDFFF)continue;const s=String.fromCodePoint(cp);const l=s.toLowerCase();if(l!==s)out.push([cp,[...l].map(c=>c.codePointAt(0))]);}
process.stdout.write(JSON.stringify({node:process.version,icu:process.versions.icu,unicode:process.versions.unicode,map:out}));
"""


def main() -> int:
    r = subprocess.run(["node", "-e", JS_DUMP], capture_output=True, text=True, check=True)
    js = json.loads(r.stdout)
    jsmap = {cp: tuple(m) for cp, m in js["map"]}
    diffs = []  # (cp, py_result_codepoints | None=identity, js_result)
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        s = chr(cp)
        l = s.lower()
        py = None if l == s else tuple(ord(c) for c in l)
        if py != jsmap.get(cp):
            diffs.append((cp, py, jsmap.get(cp)))
    lines = [
        "/**",
        " * pylower-table.ts — 자동 생성(scripts/gen-pylower-table.py). 손으로 고치지 말 것.",
        f" * 정본: Python {platform.python_version()} (unidata {unicodedata.unidata_version}) vs Node {js['node']} (ICU {js['icu']}, Unicode {js['unicode']})",
        f" * 두 lower() 가 다른 코드포인트 {len(diffs)}개. 값이 null 이면 Python 은 항등(미배정/비대문자), 배열이면 Python 의 결과 코드포인트.",
        " */",
        "export const PY_LOWER_OVERRIDES: ReadonlyMap<number, readonly number[] | null> = new Map<number, readonly number[] | null>([",
    ]
    for cp, py, _js in diffs:
        val = "null" if py is None else "[" + ", ".join(f"0x{c:X}" for c in py) + "]"
        lines.append(f"  [0x{cp:X}, {val}],")
    lines.append("]);")
    lines.append("")
    text = "\n".join(lines)
    if "--check" in sys.argv:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        # 헤더의 버전 줄은 환경마다 달라도 되므로 본문(Map 내용)만 비교
        strip = lambda t: "\n".join(l for l in t.splitlines() if l.startswith("  [") or l.startswith("]"))
        if strip(cur) != strip(text):
            print("MISMATCH: pylower-table.ts is stale — run gen-pylower-table.py")
            return 1
        print(f"pylower-table OK ({len(diffs)} overrides)")
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print(f"wrote {os.path.relpath(OUT, HERE)} ({len(diffs)} overrides)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

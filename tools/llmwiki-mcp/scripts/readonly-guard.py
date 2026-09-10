#!/usr/bin/env python3
"""readonly-guard.py — 패키지가 볼트를 절대 쓰지 않는지 검사(DESIGN §5 / P2-20). CI 와 로컬이 같은 파일을 쓴다.

    cd tools/llmwiki-mcp && python3 scripts/readonly-guard.py

원래 .github/workflows/ci.yml 안에 heredoc 으로만 있어 로컬에서 돌릴 방법이 없었다. 그 결과 P4 의
`src/cache.ts` 가 `import fs from "node:fs/promises"`(default import — 금지) 로 들어갔는데 푸시 전까지
아무도 몰랐다(배선 점검 2026-09-10). 규칙 본문은 옮기기만 했고 바꾸지 않았다.
"""
import re, sys, pathlib
# 1) import 구문 자체를 검사(2차 리뷰: named import `import { writeFile } from "node:fs/promises"` 사각지대):
#    fs 계열 모듈에서 가져올 수 있는 이름은 허용목록뿐, `* as` 네임스페이스·default import·require·동적 import 금지.
ALLOWED_IMPORT = {"promises", "constants", "readFileSync", "Dirent", "readFile", "readdir", "stat", "lstat", "realpath", "open"}
ALLOWED_MEMBER = {"readFile", "readdir", "stat", "lstat", "realpath", "open", "close", "constants", "promises", "readFileSync"}
FS_MOD = r"[\"'](?:node:)?fs(?:/promises)?[\"']"
bad = []
aliases = set()  # fs 네임스페이스 별칭(예: promises as fs) — 멤버 검사 대상
for f in sorted(pathlib.Path("src").rglob("*.ts")):
    t = f.read_text(encoding="utf-8")
    if re.search(r"import\s+\*\s+as\s+\w+\s+from\s+" + FS_MOD, t): bad.append(f"{f}: namespace import of fs")
    if re.search(r"import\s+\w+\s+from\s+" + FS_MOD, t): bad.append(f"{f}: default import of fs")
    if re.search(r"require\(\s*" + FS_MOD + r"\s*\)|import\(\s*" + FS_MOD + r"\s*\)", t): bad.append(f"{f}: dynamic fs import")
    for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*" + FS_MOD, t):
        for spec in m.group(1).split(","):
            spec = spec.strip().replace("type ", "")
            if not spec: continue
            orig, _, alias = [x.strip() for x in spec.partition(" as ")]
            if orig not in ALLOWED_IMPORT: bad.append(f"{f}: import {orig} from fs")
            if orig == "promises": aliases.add(alias or "promises")
            # named import 의 로컬 바인딩도 추적: `import { open as create }` 후 create(…,"w") 로 쓰기 우회(3차 리뷰 BLOCKER)
            if orig == "open":
                local = alias or "open"
                for c in re.finditer(re.escape(local) + r"\(([^)]*)\)", t):
                    if re.search(r"O_WRONLY|O_RDWR|O_CREAT|O_APPEND|O_TRUNC|['\"][wa]", c.group(1)): bad.append(f"{f}: {local}() with write flags")
            elif alias and orig in ALLOWED_IMPORT and alias != orig:
                pass  # 읽기 전용 함수의 별칭은 허용
    # 2) 멤버 접근 검사: fs·별칭·파일핸들(fh) 의 멤버는 읽기 전용 집합만
    names = "|".join(sorted({"fs", "fh", *aliases}))
    for m in re.finditer(r"\b(?:" + names + r")\??(?:\.promises)?\.([A-Za-z_]+)", t):
        if m.group(1) not in ALLOWED_MEMBER: bad.append(f"{f}: {m.group(0)}")
    if re.search(r"\b(?:" + names + r")\s*\[", t): bad.append(f"{f}: bracket access to fs/fh")
    for m in re.finditer(r"\b(?:" + names + r")\.open\(([^)]*)\)", t):
        if re.search(r"O_WRONLY|O_RDWR|O_CREAT|O_APPEND|O_TRUNC|['\"][wa]", m.group(1)): bad.append(f"{f}: fs.open with write flags")
if bad:
    print("READ-ONLY GUARD FAIL:\n  " + "\n  ".join(bad)); sys.exit(1)
print("READ-ONLY GUARD OK")

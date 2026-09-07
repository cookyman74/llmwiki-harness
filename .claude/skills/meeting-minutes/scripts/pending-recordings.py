#!/usr/bin/env python3
"""미처리 녹음 스캔 (deterministic — 0 LLM 토큰).

`raw/assets/`의 오디오 파일이 어느 단계까지 처리됐는지 판정한다.

  NEW          전사문 없음                    → 전사부터 (백엔드 판정 필요)
  TRANSCRIBED  전사문 있고 회의록 없음         → 회의록 작성만 남음 (싸다)
  DONE         회의록이 그 녹음을 참조         → 완료

연결 근거는 frontmatter다 — 전사문의 `source_audio:`, 회의록의 `recording:`.
파일명 규칙이 아니라 명시적 참조로 판정하므로 파일을 옮겨도 깨지지 않는다.

SessionStart 훅(wiki-status-check.py)이 이 스크립트를 호출해 미처리 건을 알린다.
전사·회의록 작성 자체는 자동화하지 않는다 — 백엔드 판정(로컬/외부)과 회의 맥락은
사람이 정해야 하고, 오판 비용이 비대칭이기 때문이다. 상세는 SKILL.md Phase 1.

사용:
  python3 pending-recordings.py [VAULT_ROOT] [--json]
"""
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

AUDIO_EXT = (".m4a", ".mp3", ".wav", ".m4b", ".mp4", ".aac", ".flac", ".ogg")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))


def read_head(path, limit=4000):
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return ""


def scan(root):
    assets = os.path.join(root, "raw", "assets")
    tdir = os.path.join(root, "raw", "meetings", "transcripts")
    mdir = os.path.join(root, "raw", "meetings")

    audios = []
    if os.path.isdir(assets):
        for dirpath, _dirnames, filenames in os.walk(assets):
            for fn in filenames:
                if fn.lower().endswith(AUDIO_EXT) and not fn.startswith("."):
                    audios.append((fn, os.path.join(dirpath, fn)))

    # 전사문: source_audio -> 전사문 경로
    transcribed = {}
    if os.path.isdir(tdir):
        for fn in os.listdir(tdir):
            if not fn.endswith(".md"):
                continue
            head = read_head(os.path.join(tdir, fn))
            m = re.search(r'^source_audio:\s*"?([^"\n]+)"?\s*$', head, re.M)
            if m:
                transcribed[m.group(1).strip()] = fn

    # 회의록: recording: 에 등장하는 오디오 파일명 -> 회의록 경로
    minuted = {}
    if os.path.isdir(mdir):
        for fn in os.listdir(mdir):
            if not fn.endswith(".md"):
                continue
            head = read_head(os.path.join(mdir, fn))
            m = re.search(r"^recording:\s*(.+)$", head, re.M)
            if m:
                for a in re.findall(r"[\w \-.]+?\.(?:m4a|mp3|wav|m4b|mp4|aac|flac|ogg)",
                                    m.group(1), re.I):
                    minuted[a.strip()] = fn

    rows = []
    for fn, path in sorted(audios):
        try:
            mb = os.path.getsize(path) / (1024 * 1024)
        except OSError:
            mb = 0.0
        if fn in minuted:
            state = "DONE"
        elif fn in transcribed:
            state = "TRANSCRIBED"
        else:
            state = "NEW"
        rows.append({"state": state, "audio": fn, "size_mb": round(mb, 1),
                     "transcript": transcribed.get(fn), "minutes": minuted.get(fn)})
    return rows


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    as_json = "--json" in sys.argv[1:]
    root = args[0] if args else DEFAULT_ROOT

    rows = scan(root)
    new = [r for r in rows if r["state"] == "NEW"]
    tr = [r for r in rows if r["state"] == "TRANSCRIBED"]

    if as_json:
        print(json.dumps({"new": len(new), "transcribed_only": len(tr),
                          "done": len(rows) - len(new) - len(tr),
                          "rows": rows}, ensure_ascii=False))
        return

    for r in rows:
        extra = ""
        if r["state"] == "TRANSCRIBED":
            extra = f"  → 회의록만 작성하면 됨 ({r['transcript']})"
        elif r["state"] == "NEW":
            extra = "  → 전사부터 (백엔드 판정 필요)"
        print(f"{r['state']:<12} {r['size_mb']:>6.1f}MB  {r['audio']}{extra}")
    print("---")
    print(f"new: {len(new)}   transcribed_only: {len(tr)}   "
          f"done: {len(rows) - len(new) - len(tr)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # 훅에서 호출되므로 절대 죽지 않는다
        if "--json" in sys.argv[1:]:
            print('{"new": 0, "transcribed_only": 0, "done": 0, "rows": []}')
        else:
            print(f"(scan failed: {e})", file=sys.stderr)
            print("---\nnew: 0   transcribed_only: 0   done: 0")

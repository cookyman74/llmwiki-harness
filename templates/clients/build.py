#!/usr/bin/env python3
"""클라이언트 규칙 스니펫 생성기 (v0.8.6 P3-02~P3-04).

정본은 `templates/mcp-client-guide.md` 하나다. 이 스크립트가 거기서 본문(H1 다음 ~ `## agy` 앞)을
떼어 클라이언트별 파생 파일 4종을 만든다. 파생 파일은 절대 손으로 고치지 않는다 — 정본을 고치고
이 스크립트를 다시 돌린다.

Usage:
  python3 templates/clients/build.py            # 파생 4종 생성(덮어쓰기)
  python3 templates/clients/build.py --check    # 디스크와 생성 결과가 동일한지 검사(exit 1 = 불일치)

파생 대상(설치 위치):
  claude-skill/SKILL.md   → ~/.claude/skills/llmwiki-query/SKILL.md
                            (agy 도 같은 형식: ~/.agents/skills/llmwiki-query/SKILL.md)
  codex-AGENTS.md         → ~/.codex/AGENTS.md 에 절 붙여넣기
  gemini-GEMINI.md        → ~/.gemini/GEMINI.md 에 절 붙여넣기
  cursor-llmwiki.mdc      → .cursor/rules/llmwiki.mdc
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(os.path.dirname(HERE), "mcp-client-guide.md")

AUTOGEN = "자동 생성 — templates/mcp-client-guide.md 를 고치고 build.py 를 다시 돌려라"
SECTION_TITLE = "llmwiki MCP — 위키 질의 규칙"
SKILL_DESC = (
    "볼트 밖에서 llmwiki MCP 서버로 LLM 위키에 질의한다 — 라우팅(단일조회·사실브리핑·절차)과 "
    "신뢰도 병기·stale 추적·읽기 전용 규약. 트리거 — \"위키에 뭐라고\", \"llmwiki 참고\", \"wiki 질의\", "
    "볼트 밖에서 위키의 개념·사실·절차를 확인할 때."
)
CURSOR_DESC = "llmwiki MCP 위키 질의 규칙 — 라우팅 표와 신뢰도 병기·stale 추적·읽기 전용 규약"


def read_source() -> str:
    with open(SOURCE, encoding="utf-8") as fh:
        return fh.read()


def body(text: str) -> str:
    """정본에서 본문만 추출 — 첫 H1 줄 다음부터 `## agy` 절 앞까지."""
    lines = text.split("\n")
    start = 0
    for i, line in enumerate(lines):
        if line.startswith("# "):
            start = i + 1
            break
    end = len(lines)
    for i in range(start, len(lines)):
        if lines[i].strip() == "## agy":
            end = i
            break
    return "\n".join(lines[start:end]).strip("\n")


def demote(md: str) -> str:
    """붙여넣기용 절(`##` 아래)에 들어가므로 본문 헤딩을 한 단계 낮춘다."""
    return "\n".join("#" + ln if ln.startswith("## ") else ln for ln in md.split("\n"))


def claude_skill(b: str) -> str:
    return (
        "---\n"
        "name: llmwiki-query\n"
        f"description: {SKILL_DESC}\n"
        "---\n"
        "\n"
        f"<!-- {AUTOGEN} -->\n"
        "<!-- 설치: ~/.claude/skills/llmwiki-query/SKILL.md · agy 는 ~/.agents/skills/llmwiki-query/SKILL.md -->\n"
        "\n"
        "# llmwiki-query\n"
        "\n"
        f"{b}\n"
    )


def paste_section(b: str, install: str) -> str:
    return (
        f"<!-- {AUTOGEN} -->\n"
        f"<!-- 설치: {install} -->\n"
        "\n"
        f"## {SECTION_TITLE}\n"
        "\n"
        f"{demote(b)}\n"
    )


def cursor_rule(b: str) -> str:
    return (
        "---\n"
        f"description: {CURSOR_DESC}\n"
        "alwaysApply: false\n"
        "---\n"
        "\n"
        f"<!-- {AUTOGEN} -->\n"
        "<!-- 설치: .cursor/rules/llmwiki.mdc -->\n"
        "\n"
        f"# {SECTION_TITLE}\n"
        "\n"
        f"{b}\n"
    )


def build() -> "dict[str, bytes]":
    b = body(read_source())
    files = {
        os.path.join(HERE, "claude-skill", "SKILL.md"): claude_skill(b),
        os.path.join(HERE, "codex-AGENTS.md"): paste_section(b, "~/.codex/AGENTS.md 에 이 절을 붙여넣는다"),
        os.path.join(HERE, "gemini-GEMINI.md"): paste_section(b, "~/.gemini/GEMINI.md 에 이 절을 붙여넣는다"),
        os.path.join(HERE, "cursor-llmwiki.mdc"): cursor_rule(b),
    }
    return {p: t.encode("utf-8") for p, t in files.items()}


def main() -> None:
    files = build()
    if "--check" in sys.argv:
        bad = []
        for p, data in files.items():
            try:
                with open(p, "rb") as fh:
                    if fh.read() != data:
                        bad.append(p)
            except OSError:
                bad.append(p)
        if bad:
            print("STALE (run `python3 templates/clients/build.py`):\n  " + "\n  ".join(os.path.relpath(x, HERE) for x in bad))
            sys.exit(1)
        print(f"client snippets OK ({len(files)} files)")
        return
    for p, data in files.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(data)
    print(f"wrote {len(files)} files under {os.path.relpath(HERE, os.getcwd())}/")


if __name__ == "__main__":
    main()

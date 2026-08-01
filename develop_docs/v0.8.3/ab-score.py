#!/usr/bin/env python3
"""A/B recall 채점 (deterministic — 0 LLM 토큰).

답변 텍스트에서 골든셋 slug 등장 여부로 recall 계산.
Usage: ab-score.py <answer.txt> <Q1|Q2>
출력: recall 비율 + 적중/누락 slug 목록.
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

GOLDEN = {
    "Q1": [
        "concept-curriculum-flow", "source-ax-rollout-reply", "concept-ax-rollout-plan",
        "concept-skill-two-types", "concept-skill-automation", "concept-engineering-ladder",
        "concept-team-ai-adoption", "concept-harness-design-spec", "concept-subagent",
        "concept-approval-gate", "source-genai-lecture-1", "source-lecture2-part1",
        "concept-llm-wiki",
    ],
    "Q2": [
        "source-ax-rollout-reply", "concept-ax-rollout-plan", "source-monthly-report-automation",
        "concept-monthly-report-automation", "query-report-to-leejh-2026-07-30",
        "session-2026-07-31", "entity-recruitment-system", "source-daily-2026-07-27",
        "entity-vault-mcp", "infra-auth-moc",
    ],
}


def main():
    if len(sys.argv) < 3 or sys.argv[2] not in GOLDEN:
        print("usage: ab-score.py <answer.txt> <Q1|Q2>", file=sys.stderr)
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        text = fh.read().lower()
    gold = GOLDEN[sys.argv[2]]
    hit = [s for s in gold if s.lower() in text]
    miss = [s for s in gold if s.lower() not in text]
    recall = len(hit) / len(gold)
    print(f"recall {recall:.2f} ({len(hit)}/{len(gold)})")
    print(f"적중: {', '.join(hit) or '-'}")
    print(f"누락: {', '.join(miss) or '-'}")


if __name__ == "__main__":
    main()

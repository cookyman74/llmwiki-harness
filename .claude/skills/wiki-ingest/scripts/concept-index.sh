#!/usr/bin/env bash
# Compact catalog of existing L3/L4 concepts — 병합 후보 판별용 (deterministic, 0 토큰).
# 인제스트 시 45개 페이지 본문을 Read하지 말고 이 한 줄 출력만 보고 신규/기존을 가른다.
# 각 줄: slug | title | aliases | confidence   (frontmatter만 읽음)
# Usage: concept-index.sh [vault_root]   (default: .)
set -uo pipefail
root="${1:-.}"
for dir in wiki/L3-semantic wiki/L4-procedural; do
  d="$root/$dir"
  [ -d "$d" ] || continue
  for f in "$d"/*.md; do
    [ -e "$f" ] || continue
    slug="$(basename "$f" .md)"
    # frontmatter 영역만 스캔 (첫 --- ... --- 블록)
    fm="$(awk 'NR==1&&$0!="---"{exit} NR>1&&$0=="---"{exit} {print}' "$f")"
    title="$(printf '%s\n' "$fm" | sed -n 's/^title:[[:space:]]*//p' | head -1)"
    aliases="$(printf '%s\n' "$fm" | sed -n 's/^aliases:[[:space:]]*//p' | head -1)"
    conf="$(printf '%s\n' "$fm" | sed -n 's/^confidence:[[:space:]]*//p' | head -1)"
    printf '%s | %s | %s | %s\n' "$slug" "${title:-?}" "${aliases:-[]}" "${conf:-?}"
  done
done

#!/usr/bin/env bash
# Compact catalog of existing L3/L4 concepts — 병합 후보 판별용 (deterministic, 0 토큰).
# 인제스트 시 페이지 본문을 Read하지 말고 이 한 줄 출력만 보고 신규/기존을 가른다.
# 각 줄: slug | title | aliases | confidence   (frontmatter만 읽음)
#
# Usage: concept-index.sh [vault_root] [filter ...]
#   filter: (선택) 하나 이상의 키워드. 주면 slug|title|aliases에 그 키워드가
#           (대소문자 무시) 포함된 줄만 출력 — 위키가 커질 때 카탈로그를 바운드.
#           예) concept-index.sh . rag vector   → rag/vector 관련 개념만.
#   필터 없으면 전체 출력. 끝에 요약 라인(총 N개 / 필터 매칭 M개)을 stderr로.
set -uo pipefail
root="${1:-.}"
shift || true
filters=("$@")

emit() {
  for dir in wiki/L3-semantic wiki/L4-procedural; do
    d="$root/$dir"
    [ -d "$d" ] || continue
    for f in "$d"/*.md; do
      [ -e "$f" ] || continue
      slug="$(basename "$f" .md)"
      fm="$(awk 'NR==1&&$0!="---"{exit} NR>1&&$0=="---"{exit} {print}' "$f")"
      title="$(printf '%s\n' "$fm" | sed -n 's/^title:[[:space:]]*//p' | head -1)"
      aliases="$(printf '%s\n' "$fm" | sed -n 's/^aliases:[[:space:]]*//p' | head -1)"
      conf="$(printf '%s\n' "$fm" | sed -n 's/^confidence:[[:space:]]*//p' | head -1)"
      printf '%s | %s | %s | %s\n' "$slug" "${title:-?}" "${aliases:-[]}" "${conf:-?}"
    done
  done
}

total=0 shown=0
while IFS= read -r line; do
  total=$((total+1))
  if [ "${#filters[@]}" -eq 0 ]; then
    printf '%s\n' "$line"; shown=$((shown+1)); continue
  fi
  for kw in "${filters[@]}"; do
    if printf '%s' "$line" | grep -qFi -- "$kw"; then   # -F: 고정 문자열(정규식 특수문자 c++·node.js·[RAG] 안전)
      printf '%s\n' "$line"; shown=$((shown+1)); break
    fi
  done
done < <(emit)

if [ "${#filters[@]}" -eq 0 ]; then
  echo "[concept-index] 총 ${total}개" >&2
else
  echo "[concept-index] 총 ${total}개 중 필터(${filters[*]}) 매칭 ${shown}개" >&2
fi

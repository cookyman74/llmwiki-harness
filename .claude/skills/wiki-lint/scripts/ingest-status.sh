#!/usr/bin/env bash
# Which raw sources are ingested? (deterministic — 0 LLM tokens)
# Reads the ingest stamp (frontmatter `ingest_status: done`) at the top of each
# raw/*.md. Raw BODY stays immutable; only this metadata block is written by
# ingest. Skipped: raw/assets/ (images) and raw/notes/ (daily-note scratch —
# opt-in ingest only, not auto-pending).
# Usage: ingest-status.sh [vault_root]   (default: .)
# Prints:  DONE <date> <file>  |  PENDING <file>   then a summary line.
set -uo pipefail
root="${1:-.}"
rawdir="$root/raw"
[ -d "$rawdir" ] || { echo "no raw/ dir"; exit 0; }

done_n=0; pend_n=0
# NUL-safe iteration over raw/*.md, excluding assets/
while IFS= read -r -d '' f; do
  # read only the frontmatter region (first block between leading --- ... ---)
  head_block="$(awk 'NR==1&&$0!="---"{exit} NR>1&&$0=="---"{exit} {print}' "$f")"
  if printf '%s\n' "$head_block" | grep -qE '^ingest_status:[[:space:]]*done'; then
    d="$(printf '%s\n' "$head_block" | grep -oE '^ingested:[[:space:]]*[0-9-]+' | grep -oE '[0-9-]+$' || echo '?')"
    printf 'DONE    %s  %s\n' "$d" "${f#"$root"/}"
    done_n=$((done_n+1))
  else
    printf 'PENDING          %s\n' "${f#"$root"/}"
    pend_n=$((pend_n+1))
  fi
done < <(find "$rawdir" -type f -name '*.md' -not -path '*/assets/*' -not -path '*/notes/*' -print0 2>/dev/null | sort -z)

echo "---"
echo "ingested: $done_n   pending: $pend_n"

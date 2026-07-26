#!/usr/bin/env bash
# List claim lines across L2-episodic so the LLM can cluster recurring claims
# for L2->L3 promotion (a claim seen 3+ times = semantic-memory candidate).
# Claims are marked in pages with a `- claim:: <text>` inline field.
# Usage: list-claims.sh [vault_root] [tier_dir]   (defaults: . wiki/L2-episodic)
# Uses grep (always on PATH; rg often absent from non-login shells).
set -uo pipefail
root="${1:-.}"
tier="${2:-wiki/L2-episodic}"
dir="$root/$tier"
[ -d "$dir" ] || { echo "no dir: $dir"; exit 0; }
# print "file: claim text" for every claim:: line
grep -rEn --include='*.md' 'claim::' "$dir" 2>/dev/null \
  | sed -E 's/^([^:]+):[0-9]+:.*claim::[[:space:]]*/\1\t/' \
  | sort || echo "no claims found in $tier"

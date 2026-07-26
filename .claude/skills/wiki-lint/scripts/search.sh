#!/usr/bin/env bash
# Grep helper over wiki pages. Slim search until the wiki outgrows index.md.
# Uses grep (always on PATH) rather than rg, which is often absent from
# non-login script shells. Usage: search.sh "<query>" [vault_root]
set -uo pipefail
q="${1:?usage: search.sh <query> [vault_root]}"
root="${2:-.}"
if grep -rin --include='*.md' -C1 -- "$q" "$root/wiki" 2>/dev/null; then
  :
else
  echo "no matches for: $q"
fi

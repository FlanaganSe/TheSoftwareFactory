#!/usr/bin/env bash
# Auto-format files after edit.
# Stub — fill in the format command once the stack is chosen.
# Example: prettier --write "$1" or ruff format "$1"

set -euo pipefail

FILE="${1:-}"

if [[ -z "$FILE" ]]; then
  exit 0
fi

# TBD: Add formatter command once stack is chosen
# Example for TypeScript: npx prettier --write "$FILE"
# Example for Python: ruff format "$FILE"

exit 0

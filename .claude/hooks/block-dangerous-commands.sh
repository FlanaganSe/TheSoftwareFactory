#!/usr/bin/env bash
# Block dangerous commands from being executed.
# This hook is a safety net — it blocks patterns that should never run.

set -euo pipefail

COMMAND="${1:-}"

DANGEROUS_PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "rm -rf \$HOME"
  ":(){ :|:& };:"
  "mkfs"
  "dd if="
  "> /dev/sda"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if [[ "$COMMAND" == *"$pattern"* ]]; then
    echo "BLOCKED: Dangerous command detected: $pattern"
    exit 1
  fi
done

exit 0

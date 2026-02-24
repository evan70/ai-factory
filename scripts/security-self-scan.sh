#!/bin/bash
# Scan AI Factory built-in skills with strict rules + internal allowlist.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCANNER="$ROOT_DIR/skills/aif-skill-generator/scripts/security-scan.py"
ALLOWLIST="$ROOT_DIR/scripts/security-scan-allowlist-ai-factory.json"

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
    echo "ERROR: Python not found (python3/python)."
    exit 3
fi

set +e
# Self-scan focuses on skill markdown/reference content; scanner source code is out of scope here.
"$PYTHON_BIN" "$SCANNER" --md-only --allowlist "$ALLOWLIST" "$ROOT_DIR/skills"
EXIT_CODE=$?
set -e

# Warnings are expected in internal docs/examples. Only fail on critical/usage errors.
if [[ $EXIT_CODE -eq 2 ]]; then
    exit 0
fi

exit $EXIT_CODE

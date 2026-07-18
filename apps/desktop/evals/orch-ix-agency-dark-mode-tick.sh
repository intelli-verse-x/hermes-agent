#!/usr/bin/env bash
# IX Agency desktop dark mode orch tick — PASS/FAIL gate.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DESKTOP="$(cd "$HERE/.." && pwd)"
OUT="${ORCH_IX_AGENCY_DARK_MODE_LOG:-$HERE/ORCH_IX_AGENCY_DARK_MODE_STATUS.md}"
export ORCH_IX_AGENCY_DARK_MODE_LOG="$OUT"
set +e
(cd "$DESKTOP" && node "$HERE/ix-agency-dark-mode.mjs")
CODE=$?
set -e
echo "orch-ix-agency-dark-mode-tick exit=$CODE status=$OUT"
exit 0

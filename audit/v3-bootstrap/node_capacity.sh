#!/usr/bin/env bash
# Install dependencies without any npm lifecycle scripts in frozen checkout.
set -euo pipefail
: "${1:?Pass source directory}" "${2:?Pass evidence directory}"
SRC="$(realpath "$1")"
EVIDENCE="$(realpath "$2")"
mkdir -p "$EVIDENCE" "$RUNNER_TEMP/npm-audit-home"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/runner_gate.py" --check-only --source "$SRC"
python3 "$SCRIPT_DIR/npm_lock_guard.py" \
  --lock "$SRC/package-lock.json" --out "$EVIDENCE/NPM_LOCK_PREFLIGHT.json"
RAW="$RUNNER_TEMP/npm-ci.raw.log"
STATUS=0
(
 cd "$SRC"
 env -i PATH="$PATH" HOME="$RUNNER_TEMP/npm-audit-home" CI=true \
   npm ci --ignore-scripts --no-audit --no-fund --no-progress
) > "$RAW" 2>&1 || STATUS=$?
python3 "$SCRIPT_DIR/safe_log.py" "$RAW" "$EVIDENCE/npm-ci.redacted.log"
{
  echo "npm_ci_exit_code=$STATUS"
  echo "npm_lifecycle_scripts=DISABLED"
  echo "node=$(node --version)"
  echo "npm=$(npm --version)"
  echo "next_from_package_json=$(node -p 'require(process.argv[1]).dependencies.next' "$SRC/package.json")"
  echo "react_from_package_json=$(node -p 'require(process.argv[1]).dependencies.react' "$SRC/package.json")"
} > "$EVIDENCE/NODE_INSTALL_ATTESTATION.txt"
if [[ "$STATUS" -ne 0 ]]; then
  echo "npm ci failed; see redacted artifact for diagnostics" >&2
  exit "$STATUS"
fi
test -f "$SRC/node_modules/next/package.json" || {
  echo "Next.js package missing after npm ci" >&2; exit 4;
}
echo "NODE_INSTALL_CAPACITY=PASS_NO_LIFECYCLE_SCRIPTS"

#!/usr/bin/env bash
# Fails if the legacy interview-source project name appears anywhere in the repo.
# The name is assembled at runtime so this script never contains it literally.
set -euo pipefail
NAME="$(printf '%s%s' 'opti' 'vus')"
if grep -rniI "$NAME" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=".next*" \
  --exclude-dir=.venv --exclude-dir=venv --exclude-dir=__pycache__; then
  echo "❌ Branding check failed: legacy name found (see lines above)."
  exit 1
fi
echo "✅ Branding check passed."

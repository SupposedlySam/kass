#!/bin/bash
# Packs Herga.app into a DMG with the branded window: the background from
# tauri/assets/dmg, the app on the left and Applications on the right.
#
#   ./scripts/build-dmg.sh [app] [out.dmg]
#
# Defaults to the app `just build` makes and Herga.dmg.
# The layout lives in scripts/dmg-settings.py.
set -euo pipefail
cd "$(dirname "$0")/.."

app="${1:-tauri/src-tauri/target/release/bundle/macos/Herga.app}"
out="${2:-Herga.dmg}"
[ -d "$app" ] || { echo "No app at $app. Build it first (just build)." >&2; exit 1; }

# dmgbuild writes Finder's layout file directly, so it works on CI without
# driving Finder. 1.6.7 is the first whose background link still works
# once the image is compressed on macOS 26, and it needs Python 3.10+.
python=""
for candidate in python3.12 python3.13 python3; do
  if command -v "$candidate" >/dev/null 2>&1 &&
    "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
    python="$candidate" && break
  fi
done
[ -n "$python" ] || { echo "Needs Python 3.10 or newer: brew install python@3.12" >&2; exit 1; }
venv=$(mktemp -d)
trap 'rm -rf "$venv"' EXIT
"$python" -m venv "$venv"
"$venv/bin/pip" install --quiet --disable-pip-version-check dmgbuild==1.6.7

"$venv/bin/dmgbuild" -s scripts/dmg-settings.py \
  -D app="$(cd "$(dirname "$app")" && pwd)/$(basename "$app")" -D root="$PWD" \
  Herga "$out"
echo "Wrote $out"

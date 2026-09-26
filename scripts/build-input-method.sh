#!/bin/bash
# Build "Voicebox Input.app", the input method Voicebox inserts dictated text
# through, into tauri/input-method/build/. Runs its tests first, then signs
# it with the same identity as the app (scripts/signing-identity.sh).
#
#   --adhoc   sign ad hoc instead (no signing identity needed)
#
# It is installed by scripts/install.sh, into ~/Library/Input Methods.
set -euo pipefail
cd "$(dirname "$0")/.."

adhoc=0
for arg in "$@"; do
  case "$arg" in
  --adhoc) adhoc=1 ;;
  *)
    echo "Unknown option: $arg" >&2
    exit 1
    ;;
  esac
done

src=tauri/input-method
app="$src/build/Voicebox Input.app"

./scripts/test-input-method.sh

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
xcrun swiftc -swift-version 5 -O -module-name VoiceboxInput \
  -target arm64-apple-macos13.0 \
  -framework Cocoa -framework InputMethodKit \
  "$src"/Sources/*.swift -o "$app/Contents/MacOS/VoiceboxInput"
cp "$src/Info.plist" "$app/Contents/Info.plist"
cp "$src/Resources/icon.tiff" "$app/Contents/Resources/icon.tiff"
plutil -lint -s "$app/Contents/Info.plist"

if [ "$adhoc" = 1 ]; then
  identity=-
else
  identity=$(./scripts/signing-identity.sh)
fi
codesign --force --timestamp=none --options runtime --sign "$identity" "$app"
codesign --verify --strict "$app"
echo "Built $app"

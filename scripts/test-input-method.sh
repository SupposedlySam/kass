#!/bin/bash
# Compile and run the Voicebox Input tests (tauri/input-method/Tests): the
# wire protocol and the insert decision, against a fake text field.
set -euo pipefail
cd "$(dirname "$0")/.."
src=tauri/input-method
out="$src/build/tests"
mkdir -p "$out"
xcrun swiftc -swift-version 5 -O -module-name VoiceboxInputTests \
  "$src/Sources/Protocol.swift" "$src/Tests/main.swift" -o "$out/run-tests"
"$out/run-tests"

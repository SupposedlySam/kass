#!/bin/bash
# Build the Python server folder and copy it where the Tauri bundle picks it up

set -e

# Determine platform
PLATFORM=$(rustc --print host-tuple 2>/dev/null || echo "unknown")

echo "Building Kass server sidecar for platform: $PLATFORM"

# Build Python binary
# Resolve PATH to absolute paths before changing directory
export PATH="$(cd "$(dirname "$0")/.." && pwd)/backend/venv/bin:$PATH"
cd backend

# Check if PyInstaller is installed
if ! python -c "import PyInstaller" 2>/dev/null; then
    echo "Installing PyInstaller..."
    python -m pip install pyinstaller
fi

# Create binaries directory if it doesn't exist
mkdir -p ../tauri/src-tauri/binaries

# The server is a PyInstaller folder (executable plus _internal/). Tauri copies
# it into Kass.app/Contents/Resources (see bundle.macOS.files).
python build_binary.py
rm -rf ../tauri/src-tauri/binaries/kass-server ../tauri/src-tauri/binaries/kass-server-*
if [ ! -x dist/kass-server/kass-server ]; then
    echo "Error: dist/kass-server/kass-server not found"
    exit 1
fi
# ditto keeps the symlinks PyInstaller creates between bundled libraries.
ditto dist/kass-server ../tauri/src-tauri/binaries/kass-server
echo "Built kass-server for ${PLATFORM}"

echo "Build complete!"

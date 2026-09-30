---
title: Build from source
description: Build and install Kass yourself, and keep permissions across updates.
---

Building Kass yourself is for working on it. To just use Kass, [download the DMG](/docs/install/).

## Requirements

- An Apple Silicon Mac
- [Xcode](https://developer.apple.com/xcode/)
- [Bun](https://bun.sh), [Rust](https://rustup.rs) and [Python 3.12](https://python.org)
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Build and install

```bash
git clone https://github.com/mrgnhnt96/kass.git
cd kass
./scripts/install.sh
```

The script checks for everything the build needs and prints how to install anything missing. It then builds the app and installs it to `/Applications/Kass.app`. Run it again to pull the latest code and update. A first build needs about 15 GB of free space.

Every build is signed with the same identity, so updates keep your Microphone, Accessibility and Input Monitoring permissions. That identity is your Apple Development certificate if you have one. Otherwise the first install creates a self-signed "Kass Local Signing" certificate, and macOS asks for your password once to trust it.

## Develop

```bash
brew install just
just setup   # Python environment and dependencies
just dev     # runs the backend and the desktop app
```

Run `just --list` to see every command.

| Part | Built with |
| --- | --- |
| Desktop app | Tauri (Rust) |
| Hotkeys, audio, text insertion | Native Rust |
| Interface | React, TypeScript, Tailwind CSS |
| Local server | FastAPI (Python), bundled with the app |
| Speech and cleanup | Whisper and Qwen3 on MLX |
| Storage | SQLite |

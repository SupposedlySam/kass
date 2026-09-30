---
title: Build from source
description: Build and install Herga yourself, and keep permissions across updates.
---

Building Herga yourself gets you the newest code, and builds that keep their permissions across updates.

## Requirements

- An Apple Silicon Mac
- [Xcode](https://developer.apple.com/xcode/)
- [Bun](https://bun.sh), [Rust](https://rustup.rs) and [Python 3.12](https://python.org)
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Install with one command

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/mrgnhnt96/herga/main/scripts/install.sh)
```

This clones Herga into `~/herga`, checks for everything the build needs and prints how to install anything missing. It then builds the app and installs it to `/Applications/Herga.app`. Run `./scripts/install.sh` from the checkout again to update.

Every build is signed with the same identity, so updates keep your Microphone, Accessibility and Input Monitoring permissions. That identity is your Apple Development certificate if you have one. Otherwise the first install creates a self-signed "Herga Local Signing" certificate, and macOS asks for your password once to trust it.

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

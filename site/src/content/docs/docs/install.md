---
title: Install
description: Download Herga, move it to Applications and give it the permissions it needs.
---

## Requirements

- A Mac with Apple Silicon (M1 or later). Intel Macs aren't supported, because the models run on Apple's MLX framework.
- About 2.5 GB of free disk space for the default models. Herga checks for the model sizes plus 500 MB of headroom before it downloads.
- An internet connection for the first model download. After that, Herga works offline.

## Download and install

1. Download the latest `.dmg` from the [Releases page](https://github.com/mrgnhnt96/herga/releases/latest).
2. Open it and drag **Herga** into **Applications**.
3. Open Herga from Applications.

:::caution[Keep it in Applications]
macOS only keeps permissions like Accessibility and Input Monitoring for apps in `/Applications`. If you open Herga from somewhere else, it offers to **Move and relaunch** for you.
:::

Release builds are signed and notarized by Apple, so they open like any other Mac app.

## First-run setup

Onboarding walks you through everything. It usually takes a few minutes, most of it the model download, which keeps going in the background while you continue.

1. **Download models.** Herga downloads Whisper Turbo (about 1.6 GB) for speech and Qwen3 0.6B (about 400 MB) for cleanup. A failed download retries on its own. If it keeps failing, you can try again or pick a smaller speech model.
2. **Input Monitoring.** This lets Herga notice your hotkey chord from any app. macOS asks you to quit Herga after you allow it. When Herga reopens, onboarding comes back to the same step and the download picks up where it left off.
3. **Accessibility.** This lets Herga put text into the app you're using. No restart needed. Without it, your dictations are still saved in Captures, but they won't be typed for you.
4. **Microphone.** Allow access, say hello, and pick a different microphone if you like.
5. **Keys.** Learn the [dictation chord](/docs/hotkeys/). You can also choose to open Herga when you log in.
6. **Your name.** Say your name and fix its spelling. It's saved to your [dictionary](/docs/dictionary/).
7. **Practice.** Try some messy speech and a [Command Mode](/docs/command-mode/) rewrite. These steps unlock once the models have finished downloading.

Any permission step can be skipped and granted later. You can run onboarding again from **Settings › Features** or from the command palette (<kbd>⌘</kbd> <kbd>K</kbd> › **Open onboarding**).

## Updating

Herga tells you when a new version is out. Download the newest `.dmg` from Releases and replace the copy in Applications. Your captures, dictionary, styles and models are kept.

Updates are signed with the same Developer ID, so Herga keeps its Microphone, Accessibility and Input Monitoring permissions.

## Coming from Voicebox

Herga used to be called Voicebox. The first time Herga opens, it brings over your captures, writing styles, dictionary and settings. macOS sees Herga as a new app, so it asks for Microphone, Accessibility and Input Monitoring once more. After that, move the old Voicebox.app to the Trash so it doesn't start at login and answer the same hotkey.

## Uninstalling

Quit Herga and move it from Applications to the Trash. Your captures and settings stay in Herga's data folder, which you can open from **Settings › General**. Your models stay in the Hugging Face cache (or wherever you moved them in the [Models](/docs/models/) tab). Delete those too if you want the space back.

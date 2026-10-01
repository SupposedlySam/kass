---
title: Privacy
description: What Kass stores, where, and the only times it uses the internet.
---

Kass is built so that your voice and your words stay on your Mac.

## What stays on your Mac

All of it:

- **Audio.** Your microphone is recorded by Kass's own native code and sent only to the local server on your Mac.
- **Transcription and cleanup.** Whisper and Qwen3 run on your Mac's GPU.
- **Your data.** Captures, corrections, your dictionary, writing styles, learned rules and stats live in a local SQLite database and folder. Open it from **Settings › General › Captures folder**.
- **Learning.** Correction rules and personal model training run locally. Training runs with Hugging Face access switched off.

The local server listens only on `127.0.0.1`, so other devices on your network can't reach it.

## When Kass uses the internet

- **Downloading models** from Hugging Face during setup, or when you pick a different model.
- **Model details.** The details pane in the Models tab loads a model's download count, likes and license from Hugging Face.
- **Update check.** At launch and every six hours, Kass asks GitHub for the version number of the latest release so it can tell you when an update is out. Nothing about you or your dictations is sent.

That's it. There's no account, no analytics, no telemetry and no crash reporting. Once your models are downloaded, you can dictate with Wi-Fi off.

## Deleting your data

- Delete individual captures from the **Captures** tab.
- Set **Keep history** to delete old captures automatically. See [Captures](/docs/captures/#keep-history).
- Turn on **Delete voice recordings** to keep only the text of each capture. See [Captures](/docs/captures/#delete-voice-recordings).
- To remove everything, quit Kass and delete its data folder, then delete your models from the Models tab or from the Hugging Face cache.

## Check for yourself

Kass is open source. Everything above can be checked in the [source code](https://github.com/mrgnhnt96/kass).

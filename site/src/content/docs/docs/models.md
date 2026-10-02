---
title: Models
description: Choose the speech and cleanup models, and where they're stored.
---

Kass uses local models, all running on your Mac's GPU through Apple's MLX framework:

- **Whisper** turns your speech into text.
- **Qwen3** cleans that text up.
- **Kokoro** reads text aloud, for [Read Aloud](/docs/read-aloud/). It's only downloaded if you use Read Aloud.

Choose Whisper and Qwen3 in **Settings › Transcription & refinement**, and manage downloads in the **Models** tab.

## Speech (Whisper)

| Model | Size on disk | Notes |
| --- | --- | --- |
| Base | 290 MB | Fastest, least accurate |
| Small | 970 MB | A good fallback for slow connections or small disks |
| Medium | 3.1 GB | |
| Large v3 | 3.1 GB | Most accurate, slowest |
| **Turbo** | 1.6 GB | **Default.** Close to Large in quality and much faster |

Turbo is the right choice for almost everyone. Whisper stays loaded while Kass is running, so your first dictation is as fast as the rest.

**Language:** Auto-detect, English, Spanish, French, German, Japanese, Chinese or Hindi. Picking your language is a little faster and more reliable than auto-detect.

## Cleanup (Qwen3)

| Model | Size on disk | Notes |
| --- | --- | --- |
| **0.6B** | 400 MB | **Default.** Fast, and good at everyday cleanup |
| 1.7B | 1.1 GB | Better with long, rambling dictations |
| 4B | 2.5 GB | Best at following your style and at Command Mode rewrites |

Larger models give better results but take longer and use more memory.

To skip cleanup and get Whisper's text as-is, turn off **Refine transcripts automatically**. You can still refine any capture later.

## Read Aloud (Kokoro)

Kokoro 82M takes about 345 MB on disk and reads about 25 times faster than real time. Its voices are picked in **Settings › Read Aloud**.

## The Models tab

From the **Models** tab you can download, cancel, unload and delete models, and **Show in Finder**. Problems with a model are flagged here too.

## Where models are stored

Models live in the Hugging Face cache on your Mac. To store them somewhere else, like an external drive, click **Move…** in the Models tab. Kass stops its local server during the move, shows the progress, and starts again when it's done. **Reset** moves them back to the default location.

You can also set the `KASS_MODELS_DIR` environment variable to choose the folder.

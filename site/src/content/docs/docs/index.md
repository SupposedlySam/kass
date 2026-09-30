---
title: Herga docs
description: Everything you need to set up and get the most out of Herga, private dictation for Apple Silicon Macs.
---

Herga is a dictation app for Apple Silicon Macs. Hold a key chord in any app and speak. When you let go, Herga transcribes what you said, cleans it up the way you'd have typed it, and puts the text into the field you were typing in.

Everything happens on your Mac. Speech recognition runs on [Whisper](/docs/models/), cleanup runs on a small local language model (Qwen3), and both use Apple's MLX framework on the GPU. There's no account, no server and no subscription.

The name comes from *jerga*, Spanish for slang: the way you actually talk. Herga used to be called Voicebox. If you're coming from it, see [Coming from Voicebox](/docs/install/#coming-from-voicebox).

## What cleanup does, and doesn't do

Speech comes out with filler words, false starts and changes of mind that typed text wouldn't have. Cleanup:

- removes filler words ("um", "uh", "like"), stutters and repeats
- applies spoken self-corrections: "Tuesday, no actually Wednesday" becomes "Wednesday"
- adds punctuation and capitals in [your writing style](/docs/writing-styles/)
- follows [spoken commands](/docs/spoken-commands/) for line breaks, lists and symbols
- spells names and terms the way your [dictionary](/docs/dictionary/) says

It keeps your words and your meaning. It never summarizes and never adds anything you didn't say. When you do want text rewritten, use [Command Mode](/docs/command-mode/).

## Where to start

- New here? [Install Herga](/docs/install/), then do [your first dictation](/docs/first-dictation/).
- Want it to sound like you? Set up [writing styles](/docs/writing-styles/) and add your names and jargon to the [dictionary](/docs/dictionary/).
- Something not working? See [Troubleshooting](/docs/troubleshooting/).

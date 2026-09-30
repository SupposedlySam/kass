---
title: Troubleshooting
description: Fixes for the most common problems.
---

## Nothing happens when I hold the chord

- Check that Herga is allowed in **System Settings › Privacy & Security › Input Monitoring**. macOS makes you quit and reopen the app after you allow it.
- Check that **Global shortcut** is on in **Settings › Dictation**.
- The default chord uses the **right** ⌘ and **right** ⌥ keys. The left-hand keys don't count. See [Hotkeys](/docs/hotkeys/).

## The pill appears, but no text shows up in my app

- Allow Herga in **System Settings › Privacy & Security › Accessibility**. Without it, dictations are only saved to Captures.
- Check that **Paste at cursor** is on in **Settings › Dictation**.
- Text goes into the field that was focused when you *started* dictating. If that field closed, find the text in **Captures** and copy it.
- Herga never types into password fields.

## Permissions keep resetting

macOS ties permissions to where an app lives and how it's signed.

- Make sure Herga is in `/Applications`. If it isn't, Herga offers to move itself.
- If you just switched from Voicebox, macOS asks for permissions once more, because it sees Herga as a new app. See [Coming from Voicebox](/docs/install/#coming-from-voicebox).
- If a permission looks granted but doesn't work, remove Herga from the list in System Settings with the **–** button, then add it again.

## It hears nothing, or the wrong microphone

Pick your microphone in **Settings › Dictation › Microphone**, and check that Herga is allowed in **System Settings › Privacy & Security › Microphone**.

## A word is always wrong

Add it to the [dictionary](/docs/dictionary/). For names and jargon, a plain term is usually enough. If Whisper keeps hearing the same wrong thing, add a replacement.

## Cleanup changed something it shouldn't have

Fix it in **Captures**. The correction is used right away and teaches the [writing style](/docs/writing-styles/) for that app. If this happens a lot with long or complicated dictations, try a larger [cleanup model](/docs/models/#cleanup-qwen3).

## The model download fails

Herga retries three times on its own. After that, click **Try again now**, or **Use a smaller model** to download Whisper Small instead. Check that you have enough free space: the models' size plus 500 MB.

## Something else

Try **Restart** in **Settings › General**. If that doesn't help, look at **Settings › Logs** and [report an issue](https://github.com/mrgnhnt96/herga/issues/new/choose) with what you see.

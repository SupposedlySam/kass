---
title: Captures and corrections
description: Review past dictations, fix mistakes so Kass learns, see your stats and choose how long to keep history.
---

## Captures

Every dictation is saved in the **Captures** tab, grouped by the app you dictated into and searchable. Each one has:

- the **audio**, so you can play it back
- **Heard**: what Whisper transcribed
- **Raw** and **Refined**: before and after cleanup

A capture gets a **Check** badge when cleanup did something it should look twice at, like changing a name, a number, a "not" or a technical term. It's worth a glance when you see one.

From a capture you can:

- **Re-transcribe** with a different Whisper model
- **Re-refine** with different cleanup options
- **Copy** the text, if it didn't land where you wanted
- **Delete** it

## Fix it, and Kass learns

When the cleaned-up text isn't what you meant, edit it right in the capture. This is the most useful thing you can do to improve Kass:

- The fix is used as an example for your next dictation right away.
- Fixes teach the [writing style](/docs/writing-styles/) of the app you dictated into.
- A misspelled name is better added to the [dictionary](/docs/dictionary/). Select it, even while you're correcting the text, click **Add to dictionary**, and type how it's spelled. You don't need to save the correction first.

Every six hours, or when you click **Check now**, a local job turns your corrections into rules. A new set of rules is only kept if it does no worse on your past corrections, and **Undo last update** rolls back to the previous set.

You can export all your corrections as JSON.

### Personal speech model

After enough corrected recordings (12 for training plus a handful set aside for testing), Kass can fine-tune the speech model to your voice while your Mac is idle. The new model is only used if it tests better, and **Undo model update** puts the old one back.

## Insights

The **Insights** tab shows how much you dictate: words, your speaking pace, time saved compared to typing, when you dictate and which apps you dictate into. Pick Today, 7 days, 30 days or All time.

## Keep history

Choose how long captures are kept in **Settings › General › Keep history**: 7 days, 30 days (the default), 90 days, 1 year or Forever.

Nothing is deleted until you confirm. The first time history would delete old captures, Kass asks you first. Your corrections, dictionary, learned names and stats are kept even after the captures they came from are deleted.

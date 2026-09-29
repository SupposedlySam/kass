# History Retention

## Problem

Captures pile up forever: every dictation keeps its audio and transcripts. The user wants old history deleted after a window they choose, 30 days by default, without Voicebox getting worse or its stats dropping when it goes.

## Setting

`capture_settings.history_retention_days`: 7, 30 (default), 90, 365 or 0 (keep forever). It sits under Settings → General → Storage as "Keep history". Choosing a shorter window asks first when it would delete captures: `GET /settings/captures/retention-preview?days=N` says how many, and the dialog names the number, in the style of the per-app "ask before moving corrections" dialog. Saving the setting sweeps before the request returns, so the Captures list the app reloads is already trimmed.

## Sweep

`services/history_retention.py` runs at server startup and then hourly. It deletes captures created before the window, in batches of 200. The newest capture (the current take) is never deleted, nor one being refined or retranscribed (`history_retention.in_use`). A dictation in progress has no row until it finishes, so it is never a candidate.

Each batch is one transaction: fold everything the batch taught (below), then delete its rows, then commit. A crash before the commit rolls back both, so nothing is lost; a folded capture is deleted in the same commit, so it is never folded twice (and the stats table's primary key would refuse a second row anyway). Audio files are removed after the commit. A crash between the commit and the unlink leaves files with no capture; each sweep deletes files in the captures folder whose name is not a capture id and that are older than the window, which never touches a dictation still being written.

Keep forever (0) skips the sweep entirely.

## Audit: what reads captures, and how it survives

| Consumer | Reads from captures | Preserved by |
| --- | --- | --- |
| `capture_feedback.py` (correction reports) | `capture_feedback` rows, FK to captures, each with a full JSON snapshot of the capture | **Kept.** Reports are the learning records and are never deleted by retention. The capture's `app_bundle_id` and `teaches_style_id` are copied onto the report (new columns), and the capture's audio is copied to `correction-audio/` with the snapshot's `audio_path` updated. SQLite does not enforce the FK (no `PRAGMA foreign_keys`), and `capture_id` stays as the record's grouping key. |
| `correction_learning.py` / `correction_rules.py` | `capture_feedback` snapshots only | Already durable: reports are kept; learned rules live in `correction-learning.json`. |
| `correction_notes.py` | examples via `personal_examples`, state in `correction-notes.json` keyed by report id | Already durable: report ids are unchanged. |
| `personal_examples.py` | reports joined to `captures.teaches_style_id` | Folded: reads `coalesce(capture, report)` for `teaches_style_id`, so an example stays in the same style. |
| `writing_style.py` (`refresh_feedback`) | reports joined to `captures.teaches_style_id` | Same coalesce; habits counts are unchanged. Calibration lives in `writing-style.json`. |
| `styles.py` (`app_corrections`, `assign_app`) | captures' app and `teaches_style_id` for corrected captures | Reads the report's copy when the capture is gone; moving an app ("bring" / "leave") updates the reports' copies too. App → style assignments (`app_styles`) are already durable. |
| `known_names.py` | the last 500 cleaned dictations and corrections | Folded: names a deleted capture wrote go into `known_names` with the newest time they were seen, and still count while that is within the last 500 dictations. |
| `usage_stats.py` (Insights, "last 7 days" card) | every dictation's words, length, app, hour, and whether it was corrected | Folded: one `retired_captures` row per deleted capture holding only numbers (words, raw words, length, app, time, fixed). Stats add these in, so totals, medians, the heatmap and period comparisons are the same after a sweep. |
| `model_improvement/data.py` | report snapshots, and the audio at the snapshot's `audio_path` | Audio of corrected captures is copied to `correction-audio/` first, so the audio test split keeps its recordings. |
| `captures.py` `app_categories` (style suggestions for new apps) | category of each app's captures | Not folded: an unconfirmed app with no captures left also leaves the app list, so there is nothing to suggest for. |
| `dictation_edits.py` | nothing (pure text functions) | Not a consumer. |

## Open questions

- The default is 30 days, so an existing install deletes captures older than 30 days on its first startup after upgrading, without the confirmation dialog.
- Corrected captures keep their transcripts (in the report snapshot) and audio (in `correction-audio/`) indefinitely, since they are the learning data. Deleting a capture by hand still deletes its reports.

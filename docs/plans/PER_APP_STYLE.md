# Per-App Writing Styles

## Problem

Voicebox has one writing style for every app. A Slack message and an email come out the same, and a correction made in Mail teaches the style used in Slack. The approved design ("Concept C") has named styles that apps are assigned to: each style has its own settings, calibration, learned habits, examples and rules, and a correction teaches only the style of the app it was made in.

## Styles

A style is a row in `writing_styles`: a name, its order, whether it is the default, and four settings that used to be global:

| Setting | Was | Effect |
| --- | --- | --- |
| Punctuation (`standard` / `casual` / `learned`) | `capture_settings.punctuation_style` | prompt section, as today |
| Capitalize the first word | new | off lowercases a common first word after cleanup, with the rule mid-sentence dictation already uses (`phrase_seams.continue_phrase`): names, "I" and acronyms keep their capitals |
| Remove filler | `capture_settings.smart_cleanup` | prompt section, as today |
| Keep technical terms exact | `capture_settings.preserve_technical` | prompt section, as today |

"Remove self-corrections" stays global: it is about what was said, not how it is written.

One style, **Personal**, is created on first run and is the default; no others ship. Users can add, rename and delete styles, up to six: each keeps its own prompt cache (see below), which the Writing style page states in MB for the model in use (`kv_bytes_per_token` from the model's config, times the largest style's prompt, rounded up the way the cache grows: 340 MB on 4B, 264 MB on 0.6B and 1.7B for your prompt). At six, "New style" is disabled and says why. Deleting a style moves its apps to the default.

`app_styles` maps a bundle id to a style and records whether the user confirmed it. An app with captures and no confirmed row uses the default style and shows as **New** until the user confirms it or picks another.

### Suggestions from the App Store category

The Rust client reads the target app's `LSApplicationCategoryType` from its Info.plist (once per app per launch) and sends it with the app; captures save it. A new app's suggested style is the one most assigned apps of the same category use, ties to the style listed first; with no category, or no assigned app in it, the default. There are no built-in category rules. The suggestion fills the "New app. Use Code for Zed?" prompt; until confirmed, dictation still uses the default.

## Migration

Existing data moves into **Personal**: the global punctuation, filler and technical settings, the calibration runs and examples in `writing-style.json`, and the notes in `correction-notes.json`. Personal gets "Capitalize the first word" on, which is what dictation does today, so nothing changes for any app until the user assigns it elsewhere. Both JSON files move to version 2, which keeps one entry per style id; version 1 files are read as the default style's entry. Nothing is deleted.

## Which corrections teach which style

A correction teaches the style its capture's app is assigned to, unless it was left behind. Moving an app that has corrections asks first: bring its N corrections to the new style, or leave them with the current one. Leaving sets `captures.teaches_style_id` on the app's captures, so their examples and habits keep teaching the old style (and fall back to the app's style if that style is deleted); bringing clears it for those that taught the old style. Examples and habits follow at once. Rules already summarized in the old style stay there, since each rule merges many corrections; the moved examples become pending in the new style, whose idle job summarizes them into its own rules. New corrections always teach the app's current style. Captures with no app recorded (uploads, dictation from before Sep 25) teach the default. Calibration runs belong to the style they were run for.

The vocabulary rules in `correction-learning.json` stay global: they fix what Whisper misheard, which doesn't depend on the app.

Each capture saves `style_id`, the style it was cleaned up with, and its flags carry it too, so the personal model trains and evaluates each correction with the prompt that produced it.

## Knowing the style before the first phrase

The target app used to reach the server only in `finish`. The focus snapshot is taken right after the microphone opens, so the Rust client now sends an `app` message as soon as it is known (with the next audio frame, like `context`). The server resolves the style there, before any phrase is cleaned. `finish` still carries the app, for older servers and in case the snapshot came late; a style never changes after the first cleanup started.

## Asking for a style by voice

A dictation can open by asking for one of the user's styles by name, and is then written in that style instead of its app's (`styles.spoken_style`). Only the very start of a dictation counts: the first words recognized, before anything else was kept.

| Said | Needs a sentence break after it |
| --- | --- |
| "Use formal mode" / "Use the formal style" | no: it is never text |
| "Formal mode." / "In formal mode:" | yes |
| "Switch to formal." / "Change over to the formal style." | yes |
| "Make this formal." / "Make it more formal." / "Let's make this sound a bit more formal." | yes |
| "I want this to be more formal." / "I'd like this to sound more formal." / "I would like it to be a little more formal." | yes |

"Formal" stands for any style's name; a name that ends in "mode" or "style" isn't said twice. A leading "okay", "um", "uh", "so" or "please" is skipped. Words for the same register pick a style named with another: "professional" picks Formal, "informal" or "relaxed" picks Casual. There is no fallback when no style has one of those names; the words stay in the text.

A sentence break is punctuation (Whisper adds it at a pause) or the end of the dictation. It keeps real openings as text: "Formal mode is off by default", "Make this formal letter shorter", "I want this to be more personal than last year's card". Only "more" is understood, so "make it less formal" never switches, and "keep it casual" is left out on purpose because it is a common message on its own. The one case still taken as a switch is a whole dictation that is only a lead-in, such as a message that says just "Make this formal."; nothing is pasted then.

The request itself is dropped: it is never cleaned up, pasted or saved in the transcript, and the next word is capitalized unless the dictation continues the field's sentence. Said alone and followed by a pause, the next phrase starts the dictation. In a streaming session it is taken from the first phrase with words (`StreamingCapture.take_spoken_style`) and from the full transcript when the session falls back to full-audio recognition. Uploads and "Retranscribe" drop it too.

The first phrase only ends at a 0.7 s pause after at least 2 s of audio, which can be many seconds in, so the style would change late. Nothing depends on how the user speaks: the session also looks at the opening words early (`style_peek_due`, `peek_style`). It recognizes the audio so far at the first 0.2 s pause after 1 s of speech, or at 2.5 s of speech without one, plus once more at 2.5 s when a pause brought the first look early. A request heard there changes the style and shows the chip at once. The look only finds the style: the text still comes from the phrase, which confirms the request (no second chip) or, when it doesn't hold one, puts the app's style back and shows that. Looks stop once the first phrase is in, at release, or when there is only one style. Each costs one Whisper pass over at most a few seconds of audio, before release; a look still running at release delays the finish by what's left of it.

The pill shows the change. The server sends a `style` event (`style_id`, `name`, and `from_name`, the style it replaced, or null when the take was already in it; not sent again when full-audio recognition hears the request a second time). Rust passes it to the HUD as `dictation:style`, and a chip rises in 8 pt above the pill on the old name, rolls up to the new one, glows once in the accent as it lands, and drifts out after about 2.7 s (`StyleChip.tsx`). The pill itself doesn't change. A quiet rising ping plays as the chip glows, 920 ms after the event, not as it fades in (`Cue::Style`, `sounds/style.wav`: A5 then A6, 200 ms, a little under the other cues; `STYLE_CUE_DELAY_MS`), only when sound cues are on, and not after Escape. The ping plays while the user is speaking, so the microphone can pick it up. Voice detection alone would never take it for a voice (tested up to 8× the file's level), but when the app schedules it, it sends a `cue` message (`start_samples`, `end_samples`: the 350 ms that start 920 ms past the audio sent so far) and voice detection skips that span, which may still be ahead of the audio, so a ping in a pause can't make a phrase or delay a cut. Whisper still hears the audio as it was. The HUD window is only the pill's 64 pt, and it takes every click over it, so the chip asks Rust for 40 pt more (`dictate_chip_space`) and gives it back when it finishes; the window grows up from its bottom edge in one `setFrame:`, so the pill doesn't move. The hide path gives the room back too, for a chip cut off by the end of the take.

From then on the style is fixed: the `app` message no longer replaces it, but the dictionary still follows the app, with the asked-for style's entries (`dictionary.for_app(bundle_id, style_id)`). The capture saves the style as `style_id`, and, when it isn't the app's, as `teaches_style_id`, so its corrections teach the style that was asked for. "Refine again" cleans a capture up in the style its corrections teach (`correction_style`), which is the asked-for style here and the old style for a capture left behind when its app moved.

## Keeping app switches fast

Measured on the user's machine (M2 Max, Qwen3-4B 4-bit, their own examples and notes, learned punctuation):

| Call | Prompt tokens reused | Time |
| --- | --- | --- |
| Cold, nothing cached | 0 / 2179 | 3.53–3.78 s |
| Same style again | 2142 / 2163 | 0.22–0.49 s |
| Switch to a style with other settings | 217 / 1093 | 1.63–2.00 s |
| Switch back | 217 / 2162 | 3.21 s |

The backend keeps one KV cache, and a different style's prompt diverges at the punctuation line in the first section, 217 tokens in. Every app switch would cost 1.6–3.2 s after release.

Options:

1. **Shared prefix, style part last.** Move every style-dependent line after the fixed examples. Still re-prefills the style's own sections and examples (about 1,100 tokens, ~1.5 s here), and changes the prompt the small models were tuned on, which risks quality.
2. **One cache per style.** A cache for this prompt is 326 MB (147 KB per token on 4B, 114 KB on 0.6B and 1.7B). Four styles are 1.3 GB, on a 64 GB machine. The prompt is unchanged, so output is identical.
3. **Prefill at key-down.** The style is known at key-down, so its prompt can be prefilled while the user speaks, as Command Mode already does for its selection.

Chosen: **2 and 3**. The backend keeps up to eight caches (six styles, Command Mode, and one for calibration previews and rule checks), least recently used first out, one per `prompt_cache_key`; cleanup names its style's key. A style's cache is continued call after call as the single cache was. A key seen for the first time starts from a copy of the longest prefix another cache shares, so a new style whose prompt opens like an existing one's skips that part. (A first version picked caches by shared prefix alone. Two styles with the same settings share over half their prompt, so each switch trimmed the other's cache: 1.5 s per switch, measured. Keys can't do that.) At key-down the session prefills its style's prompt (one generated token), which costs ~0.1 s when the cache is warm and hides the 1.4–2.6 s cold prefill behind speech when it isn't. After startup, styles with apps are prefilled in the background while nothing is dictated. The prompt itself does not change.

## Personal model

`RefinementFlags` gains `capitalize_first` and `style`; `to_dict` leaves both out at their defaults, as it does for `punctuation_style`. Training builds each sample's prompt from its snapshot's flags, which now name the style whose learned punctuation produced it. Evaluation adds every style's current flags to the flags it tests, so an accepted adapter covers every style. A style it doesn't cover uses the base model; the adapter's LoRA scale is set to zero for it rather than reloading the model, so switching between covered and uncovered styles doesn't reload anything.

## Captures

The app list shows each app's style under its name, and **New** (a dot when collapsed) for unconfirmed apps. The app card has the style dropdown. Rows show the style label, and an unconfirmed app's newest row asks "New app. Use <suggested style> for <app>?". The detail header's settings button opens Writing style with that app's style selected; command captures still open Command Mode.

## Writing style page

One page, as today, with a new top section: one column per style with its apps, dragged between columns (native HTML drag and drop), plus a "+ New style" column. Clicking a column selects that style; everything below (settings, calibration, examples, rules, reset, recent corrections) is for the selected style. Each app chip also has a menu to move it without dragging.

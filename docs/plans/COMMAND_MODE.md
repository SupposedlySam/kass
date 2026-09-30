# Command Mode and Transforms

## Problem

Dictation only adds text. Editing text that is already written means selecting it, retyping it, or pasting it into a chat window and back. Wispr Flow's Command Mode does this in place: select text in any app, hold a key, say what to do ("make this more concise", "translate to Spanish", "turn this into bullet points"), and the selection is rewritten.

Transforms are the same thing with a saved instruction: "Polish", "Prompt Engineer", or anything the user adds, run by name.

## Flow

```
press command chord ──► microphone opens (same as dictation)
                    ├─► focus snapshot, then the selection is read (native, while the user speaks)
                    │     none ──► take ends, pill says "Select text to rewrite first"
                    └─► selection goes to the server, which prefills the model with it
release ──► last phrase recognized ──► instruction = transcript
        ──► instruction names a transform? use its stored instruction
        ──► local Qwen rewrites the selection ──► capture saved (selection, instruction, result)
        ──► result replaces the selection through the insertion chain
```

### 1. Chord

A third chord, `chord_command_keys` in capture settings, edited with the same `ChordPicker`. Hold to talk, release to run: a toggle variant isn't needed for a sentence-long instruction. An empty chord turns Command Mode off. Default: right ⌘ + right ⇧, which shares no chord with the dictation defaults (right ⌘ + right ⌥, plus Space for toggle).

`hotkey_monitor` gets a `ChordAction::Command`. A command take is a dictation take with a `TakeMode::Command`; the microphone, stream, recovery and batch fallback are shared.

### 2. Reading the selection (Rust)

Right after the focus snapshot, on a blocking thread, while the user speaks:

1. **Accessibility.** The focused element's `AXSelectedTextRange` and `AXStringForRange` (falling back to `AXSelectedText`). A zero-length range is a definite "no selection".
2. **⌘C fallback,** only when Accessibility can't say (no focused element, no range: Electron without its tree, some web views). Save the clipboard, send ⌘C, watch the change count for up to 250 ms, read the text, restore the clipboard. An unchanged clipboard means nothing was selected.

Gecko browsers read fine through Accessibility; only their writes are unreliable (c864aba), and the insertion chain already skips those. Apps whose Accessibility text is not their input (terminals, `CLIPBOARD_ONLY_BUNDLES`) have no editable selection, so command takes there end with a message instead of pasting at the prompt.

The result reaches the stream client through the take's audio channel (`AudioMsg::Selection` / `AudioMsg::Decline`), so the driver stays event-driven: a missing selection ends the take at once, and `finish` waits for the selection only if the user released before it was read.

### 3. Server

Protocol additions to `/captures/stream` (older clients never send them):

- `start.source = "command"`.
- `{"type": "selection", "text": ..., "app": {...}}`, up to 64 KB, before `finish`.

A command session transcribes phrases as usual but skips dictation cleanup (the instruction isn't the output). When the selection arrives it prefills the model with the command prompt and the selection (a one-token generate; the MLX backend's prompt cache keeps it), so after release only the instruction's few tokens are new. At finish it runs the rewrite and persists a capture with `source = "command"`.

`services/commands.py`:

- The model is the dictation cleanup model (`llm_model`). There is no separate Command Mode model setting, so a command and a dictation never switch models.
- `build_command_prompt()`: a dedicated system prompt, never the dictation one. Do exactly the instruction and nothing else; keep the author's voice (vocabulary, person, tone, formatting) wherever the instruction doesn't ask for a change; translation allowed; output only the rewritten text. Few-shot turns as chat pairs, like refinement.
- User turn: the selection first, the instruction last. Recency helps small models follow it, and it makes everything but the instruction prefillable while the user speaks.
- Generation uses lookup decoding with the prompt as its source (`generation_hint`), since most rewrites copy much of the selection.
- `match_transform()`: the spoken instruction names a transform when, after removing punctuation, case, leading requests ("please", "run", "apply", "use", "can you") and trailing references to the selection ("this", "that", "it", "the text", "the selection"), it equals the transform's name. General rule, no per-transform phrases.
- Post-processing: keep the selection's own leading and trailing whitespace, and unwrap the prompt's own `<text>` markup if the model echoes it. An empty result is an error, and nothing is replaced.
- The content check is not applied: rewrites change content on purpose.

`POST /commands/run` runs a command without audio: `{instruction, selection, app_bundle_id?, app_name?}` for the palette, or `{capture_id, selection}` to turn a batch-uploaded command recording into a command (the stream's fallback path). It returns the saved capture.

### 4. Replacing the selection

The final text goes through `paste_final_text_with` unchanged. Every step of the chain already replaces a selection: an `AXSelectedText` write replaces it (and `judge` accounts for the selection's length), typing replaces it, and ⌘V replaces it. `fit_to_focused` still fits the edges to the text around the selection.

A command always replaces the selection. The "Paste automatically" setting doesn't apply, because replacing the selection is the whole point of the command.

### 5. Captures

`captures` gains `command_selection`, `command_instruction` and `command_transform`. For a command capture, `transcript_raw` is what was said and `transcript_refined` is the result. The Captures tab shows the result, the instruction (or transform) and the original selection, with **Copy original** so a bad rewrite can be undone anywhere. Most apps also undo it with ⌘Z. Teach-correction is hidden for command captures, and they are left out of name learning and the writing-style preview: a translation isn't the user's writing.

### 6. Transforms

`capture_settings.command_transforms`: a JSON list of `{id, name, instruction}`, defaulting to Polish and Prompt Engineer. Users can edit or delete the defaults. Settings has a list editor.

- **By voice:** `match_transform` above.
- **From the ⌘K palette:** one command per transform. Kass's window is in front then, so Rust finds the app the user came from (the frontmost on-screen window that isn't Kass's), reads its selection, calls `/commands/run`, brings the app back, and inserts. The pill shows progress.

## Latency budget

Target: text in place within ~1 s of release.

| Stage | Where | After release? |
| --- | --- | --- |
| Selection read | Rust, during speech | no |
| Command prompt + selection prefill | server, during speech | no |
| Last phrase recognition | server | yes (~150-300 ms, as for dictation) |
| Rewrite generation | server | yes, proportional to output length; lookup decoding for copied spans |
| Insertion | Rust | yes (3-20 ms) |

No cleanup pass runs on the instruction, and there's no extra HTTP round trip: the rewrite runs inside the stream session.

The model backend keeps two prompt caches, one for the command prompt and one for the cleanup prompt, and uses whichever shares the longest prefix with the call. So a dictation right after a command doesn't process its ~1k-token prompt again, and a command right after a dictation doesn't either.

## Measurements

M-series Mac, eight realistic selections, with instructions spoken through `say` into a real `/captures/stream` command session, streamed in real time. Timings run from release to `final` on the server; insertion adds 3–20 ms.

| | 0.6B | 1.7B | 4B |
| --- | --- | --- | --- |
| Rewrite after release, prefilled (short edits) | 0.06–0.25 s | 0.13–0.46 s | 0.25–0.95 s |
| Same, without prefill | 0.23–0.35 s | 0.49–0.77 s | 1.0–1.7 s |
| Prompt Engineer (~125 output tokens) | 1.1 s | 2.1 s | 4.7 s |

End to end with 1.7B: short edits take 0.70–1.03 s from release to final. About 0.6 s of that is Whisper recognizing the instruction, which is too short to be cut at a pause while it is spoken. The rest is the rewrite. Prompt Engineer takes 2.5–2.8 s, bound by output length.

### Quality on the shared model

Commands run on whichever cleanup model dictation uses, so the prompt must work on all three. The eight rewrites were re-run with `scripts/eval-command-mode.py` (prefilled, then rewritten; several samples per model at production's temperature 0.2) on the prompt before and after the changes below. A rewrite passes when it does what was asked and keeps the facts: a concise version at most 80% as long with every point, formal English with no slang, correct translations with the same day and time, and so on.

| | 0.6B | 1.7B | 4B |
| --- | --- | --- | --- |
| Before | 23/48 | 39/48: kept "Yo" and "pls" when asked to be formal (6/6), Thursday became *vendredi* (2/6) | 35/48: barely shortened "concise" (6/6), Thursday became *mercredi* (6/6) |
| After | 21/48 | 85/88: 3 of 11 concise rewrites read "might need to push it" (delay it) as "should push it" | 77/88: every miss is *mercredi* |
| Short edits after release, prefilled | 0.06–0.25 s | 0.08–0.45 s | 0.3–0.9 s |

What changed the results:

- **No example in another language.** With the Spanish translation example anywhere in the prompt, 0.6B answered "rewrite this more formally" in Spanish. Placing it first stopped this on 1.7B and 4B but not on 0.6B. Without it, 1.7B and 4B still translate correctly from the rules alone.
- **Tone and length ask for a noticeable change.** The old rule ("change as much wording as it needs, and no more") let 4B keep nearly every word of a "more concise" request. The formal example now starts with slang, and the concise example drops hedges and filler.
- **Facts cross translations unchanged,** days and times included.

What prompt changes could not fix:

- **4B translates Thursday as *mercredi*.** It does so with no system prompt at all, so it is the quantized model's error, not the prompt's. A French weekday example would hide this one case, which is the kind of special case the prompt avoids.
- **0.6B misreads instructions.** Without the Spanish pull it answers "more formally" in English but often replies to the text ("You are correct in pointing out…"). Its translations are wrong (*ayuno* for "yesterday", 3h45 for 3 pm), and its casual rewrites add emoji. Command Mode needs 1.7B or 4B as the cleanup model.
- **Small wording changes move 1.7B a lot.** Adding "unless the instruction asks you to change it" to the facts rule brought back "Yo" on every sample, and a different concise example made it write "Apple's". Check any prompt change against all eight rewrites on all three models, with several samples.

A dictation cleanup right after a command, 4B: 1.7–1.9 s with one prompt cache, 0.24–0.26 s with separate caches (0.25–0.3 s after another dictation).

Findings that changed the design:

- With the translation example last, every model translated "rewrite this more formally" into Spanish. Moving it first fixed 1.7B and 4B only; it is now gone.
- Commands first ran on their own model (1.7B by default), so a dictation right after a command reloaded its model after release (1.4–1.6 s instead of 0.9 s). Commands now run on the cleanup model, and a dictation still loads its model and personal adapter while the user speaks.

## Open questions

1. **Personal adapter.** Commands run on the base weights. When a personal adapter is active for cleanup, a command and a dictation still reload the model; both reloads happen while the user speaks (the command prefill and the dictation's early load). Running commands with the adapter would remove the reload, but adapters are only tested on cleanup.
2. **Long selections.** Generation time grows with output length. Selections are capped at 16k characters. A progress message for long rewrites could come later.
3. **Read-only selections.** Text selected on a web page reads fine but can't be replaced. The insertion chain then reports "saved in Captures". Wispr answers questions about such text; that's out of scope.
4. **Pill identity.** The pill looks the same for dictation and commands. A distinct recording tint could come later.
5. **Recognition after release.** A short instruction is recognized whole after release (~0.6 s with Whisper turbo), the same cost as a short dictation. A speculative recognition at the pause before release would cut most of that, for dictation as well.

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
- **From the ⌘K palette:** one command per transform. Voicebox's window is in front then, so Rust finds the app the user came from (the frontmost on-screen window that isn't Voicebox's), reads its selection, calls `/commands/run`, brings the app back, and inserts. The pill shows progress.

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

## Open questions

1. **Model size.** Cleanup is tuned for 0.6B. Following free-form instructions needs more model. Measure 0.6B / 1.7B / 4B, then decide whether Command Mode gets its own model setting.
2. **Long selections.** Generation time grows with output length. Selections are capped at 16k characters. A progress message for long rewrites could come later.
3. **Read-only selections.** Text selected on a web page reads fine but can't be replaced. The insertion chain then reports "saved in Captures". Wispr answers questions about such text; that's out of scope.
4. **Pill identity.** The pill looks the same for dictation and commands. A distinct recording tint could come later.

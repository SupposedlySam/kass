# Mid-sentence dictation

## Problem

Every take is cleaned up as if it were a whole message. Refinement capitalizes the first word and ends with a period, and insertion puts the text exactly at the caret with no regard for what surrounds it. That is right in an empty field and wrong everywhere else:

| Field before (`|` = caret) | Spoken | Inserted today | Wanted |
| --- | --- | --- | --- |
| `I think we should|` | "move the meeting to Friday" | `I think we shouldMove the meeting to Friday.` | `I think we should move the meeting to Friday.` |
| `I think we should |` | "move it" | `I think we should Move it.` | `I think we should move it.` |
| `Can you | before lunch?` | "send the report" | `Can you Send the report. before lunch?` | `Can you send the report before lunch?` |
| `Done.|` | "next we ship it" | `Done.Next we ship it.` | `Done. Next we ship it.` |
| `Ask |` | "Morgan about it" | `Ask Morgan about it.` | unchanged (a proper noun stays capitalized) |

Nothing in the pipeline knows what is around the caret. `focus_capture::capture_focus` records the app, pid, and element role. The text next to the caret is never read, so neither refinement nor insertion can adjust.

## Approach

Read a few characters on each side of the caret, then use them in two places:

1. **Refinement (text).** Tell the model whether the take continues a sentence, so it decides the first word's case. The model can tell "move" from "Morgan", and a rule can't.
2. **Insertion (characters at the join).** Fix the spacing and punctuation where the text meets its neighbors with deterministic rules at the moment of insertion. This is exact and free, and it doesn't depend on the model following instructions.

Where context can't be read (no Accessibility text access, as in some Electron and terminal fields), keep today's behavior. A field we can't see is treated like an empty one, which is what we do now.

## 1. Read the caret context

New `InsertContext { before: Option<String>, after: Option<String> }`: up to ~16 UTF-16 units before the selection start and ~4 after the selection end. When text is selected, the take replaces it, so the context is what surrounds the selection.

Read it twice:

- **At key-down**, next to `capture_focus` in `hotkey_monitor.rs::apply_effect`, for refinement. Do it on a blocking task after the mic has opened and focus has been captured, never ahead of either, so it adds nothing to time-to-first-audio. It uses `AXSelectedTextRange` and `AXStringForRange`, with a fallback to slicing `AXValue`, which is `text_in` in `text_insert.rs`. Store it on the take next to `focus`.
- **At insertion**, for the join rules. It is authoritative because the user may have typed or moved the caret while talking. The AX path already calls `observe()` and has `string_for_range`, so this costs one extra read. For keystroke and clipboard insertion, do the same AX read first when the element allows it.

Send the key-down `before` text to the backend with the take, the same way `TargetApp` goes (`dictation/protocol.rs`, then `capture_stream.py` or the `/captures` form). Store it on the capture so re-refining and model improvement see the same input.

## 2. Refinement: the continuation hint

Derive `continues_sentence` from `before`. It is false when `before` is empty or only whitespace, or when it ends in `.`, `!`, `?`, or a newline, optionally followed by closing quotes or brackets and whitespace. Otherwise it is true.

When true, `refine_transcript` adds one short instruction: *"This text continues a sentence already in progress. Start with a lowercase letter unless the first word is a proper noun, acronym, or 'I'."* Pass the last few words of `before` as well, so the model sees what it is continuing.

- Add it as a `RefinementFlags` field, so the prompt only changes for takes that need it and the usual prompt stays byte-identical for caching.
- Add few-shot examples of continuation takes to `refinement_examples` only when the flag is set.
- `prepare_refinement` and the structured-edit bypass in `dictation_edits.py` skip the LLM. They need a small deterministic lowercase of their own when the first word is plain title case, i.e. not "I", not all caps, and with no inner capital as in "GitHub".
- With refinement turned off, apply the same deterministic lowercase to the raw transcript. Whisper capitalizes the first word too.

The period at the end stays the model's decision. Ending in the middle of a sentence is decided at the join below.

## 3. Insertion: fitting the join

A pure function in a new `tauri/src-tauri/src/join.rs`: `fit(text, ctx) -> String`, used by every insertion method.

Leading edge:
- `before` ends in a word character or closing punctuation, and `text` starts with a letter or digit: add one space.
- `before` ends in whitespace and `text` starts with whitespace: remove the text's leading whitespace.
- `text` starts with `,.;:!?)` or a closing quote: add no space.
- `before` ends in an opening bracket or quote: add no space.

Trailing edge:
- The first character of `after` that isn't a space is a lowercase letter or a digit, so the sentence keeps going: drop a final `.` from `text`. Only a lone period is dropped, not `?` or `!`, since a question in mid-sentence is rare but real. Then add one space if neither `after` nor the text already has whitespace at that point.
- `after` starts with `.`, `,`, `;`, `:`, `!`, or `?`: drop the text's own final `.` so the result doesn't get a doubled `..` or `.,`.
- `after` is empty, starts a new line, or continues with a capital letter (a new sentence): leave the text's ending as it is, and only fix the spacing.

This runs on the text we *insert*. The capture keeps the refined text, so the Captures tab and the learning code see what the model produced.

### Live insertion

`begin_live`, `extend_live`, and `finish_live` write provisional text as it streams in, and `rewrite` keeps the shared prefix. `fit` is prefix-stable at the leading edge: the same first character always gets the same space. The trailing rules only run in `finish_live`. So the start of each provisional chunk goes through `fit`, the full `fit` runs on the final text, and the `Owned` bookkeeping tracks the fitted text. Read the context once, in `begin_live`, and reuse it for the whole take.

## 4. Corrections and learning

If the user fixes a join that came out wrong, the difference between refined and inserted text must not count as a correction to learn from.

- Store `insert_context` and the actually inserted text on the capture. `capture_feedback.py` and `TeachCorrection.tsx` compare the user's edit against the **inserted** text, and train on the pair with the hint included.
- Personal examples (`personal_examples.py`) should carry `continues_sentence`. Otherwise a lowercase continuation example teaches the model to lowercase whole messages.

## Tests

- `join.rs`: table tests for every rule above, including emoji and other multi-unit UTF-16 characters in `before` and `after`, a replaced selection, an empty field, a caret right after a newline, and text that is only whitespace.
- `text_insert.rs`: extend the fake `AxTextTarget` so the tests check that the context comes from the right ranges, and that live insertion keeps its prefix stable once fitted.
- Backend: `continues_sentence` detection. The prompt stays byte-identical when the flag is off. The deterministic lowercase leaves "I", "I'm", "NASA", and "GitHub" alone.
- Refinement samples: add mid-sentence cases with proper nouns ("ask Morgan", "on Friday") to the model-improvement evaluation set, and check how often the local Qwen model gets the case right with the hint.
- Real-app check, using `insert_bench.rs`: TextEdit, Notes, Slack, Chrome textarea, and Messages. Measure the added AX read at insertion, which should be about a millisecond.

## Order

1. `join.rs` plus reading the context at insertion. This fixes all the spacing and doubled punctuation, needs no backend change, and ships by itself. **Done.** `text_insert::fit_to_focused` runs once before the insertion chain in `run_insert_chain`, and live insertion reads the context in `begin_live` and keeps it on `Owned`. Insertion into Voicebox's own window, which goes through the DOM, is not fitted yet. `insert_bench::caret_context_bench` measures the extra AX read in TextEdit.
2. Reading the context at key-down plus the refinement hint. This fixes capitals.
3. Capture fields and the correction and learning changes.

## Open questions

- How far back should the model see? A few words helps it choose case, but the first sentence of an email pasted as context is also a privacy question and makes the prompt longer. Start with at most the last ~8 words of the current sentence.
- Should mid-sentence `?` and `!` also be dropped when `after` is a word? Proposed: no.
- Where no context can be read, should the app's past takes decide? For example, Terminal fields are nearly always mid-line. Proposed: no, until real data shows a need.

# Voice edits

Fixing a word Kass just typed meant selecting it and retyping. Now the user holds the normal dictation chord and opens with an edit phrase instead: "fix that, Morgan not Megan", "edit, change Tuesday to Thursday", "fix that, delete actually", "fix that, add tomorrow after meeting", or a spelled word, "fix that, Meghan, M-E-G-H-A-N". Nothing is selected; the edit applies to Kass's own last take. A beta feature (`voice_edits` in `backend/beta.py`, `app/src/lib/betaFeatures.ts`, `updater::beta_features_on`), with its own setting, **Voice edits** (on by default, shown only on the beta channel). With the beta off, dictation is unchanged.

## Phase 1 scope

Only the last take, still intact in the field, and only where the Accessibility write lands and reads back. Anything else is declined with the error cue and nothing changes.

- **The last take.** `Owned` (`text_insert.rs`) used to live only inside `Live` while live text ran, and was dropped at `finish`. Now the take that pasted is kept in `dictation/last_take.rs`: from `finish_live` (which returns the final `Owned`) or, when the insertion chain's Accessibility step wrote it, from `owned_before_caret` (the text reads back right before a bare caret). Keys and ⌘V paths aren't tracked. The next take that pastes replaces it; an edit updates it, so a second "fix that" works on the fixed text. Whether it is still intact (`intact()`: same text, caret right after it, same app) is checked when the edit is applied, so typing, moving the caret or changing fields declines it.
- **Apps.** Gecko writes away from the caret (`writes_at_caret`) and is declined. Safari's web fields accept and ignore `AXSelectedText`, so the Accessibility step never inserts there, nothing is tracked, and an edit says there is nothing to fix. A write that is ignored during an edit restores the caret and changes nothing (`EditError::NotApplied`).

## Flow

```
key-down ──► last take (≤1000 chars of its end, from a word) + capture id ──► `last_take` message
first phrase (raw, before cleanup) opens with "fix that" / "edit" / "Kass" ──► held as an edit: never cleaned
peek of the opening words (as the style peek) ──► `edit` event ──► Cue::Edit, marked for voice detection
release ──► services/voice_edits.plan(raw, last take) ──► final event `edit: {before, after}` or `{declined}`
       ──► Rust: edit_focused(before → after) through `rewrite`, whole words only ──► Done, or the error cue
```

Detection runs on the raw transcript right after `take_spoken_style` (and on the full-audio path), because cleanup swaps "change Tuesday to Thursday", drops "fix that", and `apply_spoken_corrections` resolves "Morgan, no, Megan" as a self-correction. A take that opened like an edit but says none ("Fix that, the parser is fine") is cleaned up whole after release.

## Parsing and matching (`backend/services/voice_edits.py`)

- Triggers: "fix that", "edit", "Kass", leading, after optional filler. "Kass" is heard reliably only when prompted, so while voice edits are on the app's own command words (`COMMAND_TERMS`) lead Whisper's prompt terms; misheard variants are never matched. A trigger counts when a mark sets it apart ("Fix that,") or the words after it parse as an edit ("fix that add ...").
- Forms, case- and punctuation-insensitive: `X not Y`, `not Y, X`, `X instead of Y`, `change|replace|swap X to|with Y`, `delete|remove X`, `add|insert X after|before Y` ("at" too, as Whisper once heard "add"), `X, no, Y` (whichever side the take has is the wrong one), and spelled letters (an all-caps run from `join_spelling`), with the word said as a hint. A negated verb ("is not") is a sentence, not an edit.
- Declined: X equal to Y without spelling (Whisper collapses Meghan/Megan, Jon/John), a word not in the take, two equally good matches.
- Matching: exact, then case-insensitive, then one edit for words of five letters or more with the same first letter; word-aligned; nearest the caret wins. Spelled letters match by how they sound (the dictionary's `_sound`) and take the case of the word they replace.
- The replacement keeps Whisper's capital only where it says something (not at the start of a sentence, not in an all-lowercase transcript); a deletion takes its comma and a space and recapitalizes a sentence it began.

## Records

An edit is saved like a Command Mode capture (`source = "command"`, transform "Voice edit"): the take before as the selection, "“Megan” → “Morgan”" as the instruction, the take after as the result. Command captures are already left out of learning, known names and usage stats. A declined edit is saved without a result.

## What a fix teaches

`voice_edits.learn_from` runs after the final event, off the event loop:

- A correction report (`source = "voice_fix"`, docs/plans/CORRECTION_LEARNING.md) on the capture that wrote the text: its refined output (raw without refinement) with the same change. The field's text can differ from the output at its edges, so `corrected` finds the change by its words and up to 16 characters around them, and files nothing unless that occurs exactly once. Rust doesn't confirm the write landed; a failed apply already plays the error cue.
- A spelled word goes in the Dictionary as a spelling-only entry (`dictionary.add_spelled_word`, docs/plans/DICTIONARIES.md), so Whisper is prompted with it from the next dictation without it respelling a real "Megan".

## Left for later

- Safari and other apps that ignore Accessibility writes; Gecko; keys/⌘V deliveries.
- The batch fallback (stream failed before finish) pastes an edit phrase as text.
- A sound of its own for `Cue::Edit` (it borrows the style sound, quieter).

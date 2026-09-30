---
title: Command Mode
description: Select text in any app and rewrite it by saying what you want.
---

Dictation keeps your words. Command Mode changes them. Select some text in any app, hold the command chord and say what to do with it. The rewrite replaces your selection.

## Use it

1. Select text in any app.
2. Hold <kbd>right ⌘</kbd> + <kbd>right ⇧</kbd>.
3. Say an instruction, then let go:
   - "make this friendlier"
   - "turn this into bullet points"
   - "translate to Spanish"
   - "fix the grammar but keep it casual"

Press <kbd>⌘</kbd> <kbd>Z</kbd> in the app to undo a rewrite. The original is also saved in [Captures](/docs/captures/).

## Transforms

Transforms are instructions you've saved under a name. Say the name instead of the whole instruction. Herga comes with two:

- **Polish** fixes grammar, spelling and punctuation and smooths awkward phrasing, without changing your tone or meaning.
- **Prompt Engineer** turns rough notes into a clear prompt for an AI assistant.

Add your own in **Settings › Command Mode**. You can also run a transform on selected text from the command palette (<kbd>⌘</kbd> <kbd>K</kbd>).

## Settings

In **Settings › Command Mode** you can change the chord or turn Command Mode off. The chord must be different from your dictation chords.

## Limits

- A selection can be up to 16,000 characters. Longer selections take several seconds, especially on the larger cleanup models.
- Terminals can't be rewritten.
- If the selection can't be edited, for example on a web page, the rewrite is saved in Captures so you can copy it.
- If nothing is selected, Herga asks you to select text first.

Rewrites use the same local cleanup model as dictation, so a larger [model](/docs/models/) gives better results for complex instructions.

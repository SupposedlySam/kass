# Spoken text edits

Smart cleanup now recognizes a conservative set of explicit English formatting commands before model refinement:

- At a sentence boundary, `add a new line and then create a list of item A, item B, and item C` creates three Markdown bullets.
- A trailing `actually no, remove that list` retracts the list and its formatting cue, retaining preceding prose.
- `remove the last item` removes only the final item.
- Spoken breaks create line/paragraph breaks anywhere in the take: `new line`, `newline`, `line break`, `next line`, `new paragraph`, `paragraph break`, alone or led by a verb (`add a new line`, `insert a line break`, `go to the next line`). Commas Whisper put around the command are dropped and the next line starts with a capital. A break at the very start or end is kept, so a take can start or end on a new line (the streaming close adds its period before a trailing break), and a take that is only `new line` pastes a line break. A break that is talked about stays as words: after an article, possessive or preposition (`a new line of products`, `on the next line`), before a noun (`the newline character`, `line breaks`), in quotes, or a bare `next line` mid-sentence.
- Spoken marks become characters anywhere in the take (`apply_spoken_marks`, run before line breaks so a quoted `new line` stays words):
  - Pairs: `open quote` / `start quote` … `end quote` / `close quote` / `unquote` → `"…"`; `open paren(thesis)` … `close paren` → `(…)`; `open bracket` → `[…]`; `open curly brace` or `open curly bracket` → `{…}`; `open angle bracket` or `open caret` (Whisper's `carrot`) → `<…>`. A bare `quote`, `parentheses`, `brackets`, `braces` opens and, said again, closes. An opening mark sits against the next word, a closing mark against the previous one, and Whisper's commas around the command are dropped.
  - Symbols: `slash`, `backslash`, `caret` join the words around them (`and/or`, `\n`, `x^2`); `pipe` or `vertical bar` stands between them (`ls | grep`). `carrot` is `^` only as `carrot symbol`/`sign`/`character`.
  - Talked-about marks stay words: after an article, possessive or preposition (`get a quote`, `in parentheses`, `a vertical bar`), a bare pair word with no partner (`quote me on that`), `quote unquote` with nothing between, and a bare symbol followed by its object (`slash the budget`, `pipe it into grep`). An explicit `open`/`end` mark applies alone.
  - The content check rejects a cleanup that drops any of these characters, so the transcript with its marks is kept instead.

Requires automatic refinement and Smart cleanup. Retractions also require Remove self-corrections. Existing settings are used; no model download or settings migration is needed.

Line breaks don't bypass cleanup: `apply_line_breaks` turns them into real breaks first, and `refine_transcript` cleans each line with its own model call (a small model flattens breaks it is given), relaying the lines before the current one to the provisional-text listener. Recognized list edits bypass the generative rewrite so the small model cannot restore removed text or flatten the list. This means surrounding prose is retained as transcribed, without additional filler/grammar cleanup in these takes. Other transcripts still use the existing model refinement. This is a bounded formatting feature, not a general voice editor: only one final comma-separated list, optionally followed by a supported correction, is parsed. Quoted commands, ambiguous item boundaries, additional sentences after a list, and unknown revisions fall back to existing refinement. An entirely canceled take without preceding prose also falls back because empty refined text is not supported by the capture delivery path.

## Verification

- Actual local Qwen3 0.6B baseline retained both examples' spoken formatting instructions.
- A prompt-only experiment produced unrelated example text or removed the wrong sentence; it was discarded.
- The final production refinement service returns the expected opening sentence for the canceled list and the opening sentence plus three bullets for the retained list. Terminal punctuation is retained.
- Ordinary and reported commands continue through the unchanged model path. Exact wording is still model-dependent (the live probe added a comma / the word `to`); this change does not resolve those existing small-model limitations.
- Regression tests cover the user's examples, literal/reported commands, ambiguous lists, settings opt-outs, last-item removal, paragraphs, bypassing generative rewriting for resolved edits, and continued model refinement for ordinary speech.
- Focused backend suite: 38 tests passed. Frontend TypeScript checks passed.

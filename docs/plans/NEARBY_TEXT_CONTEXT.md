# Better use of nearby text

## Problem

The text around the caret knows things the audio doesn't: how the user spells the names in this thread, the identifiers in this file, whether the sentence is still open, and what message is being answered. Voicebox reads some of it today, but uses it for one decision only: whether the take continues a sentence. A name that sits two lines above the caret ("Saoirse", "Kubernetes", `getUserById`) is still misheard, because neither Whisper nor cleanup is told about it unless the caret happens to be mid-sentence.

This plan maps what is read and used today, what macOS and Whisper allow, and ranks the options. It is research, not a build: nothing here is implemented yet.

## What exists today

### Reading (Rust)

Two reads, both through Accessibility on the focused element of the target app (`AXSelectedTextRange`, then `AXStringForRange`, falling back to slicing `AXValue`; `text_insert::text_in`). Every AX call has a 250 ms timeout (TEXT_INSERTION.md).

| Read | Where | When | How much | Used for |
| --- | --- | --- | --- | --- |
| Sentence before the caret | `text_insert::sentence_before_focused`, called from `dictation::set_focus` on a blocking task | Just after key-down, after the mic opened and focus was captured | Up to 600 UTF-16 units before the caret or selection (`SENTENCE_BEFORE`) | Sent to the backend as `{"type": "context", "before": ...}` (`protocol::context_message`), once, with the first audio after it is known or ahead of `finish` (`StreamClient::context_action`) |
| Join context | `text_insert::caret_context` / `context_at` | At insertion (`fit_to_focused`, and once in `begin_live` for live insertion) | 16 units before, 4 after (`CONTEXT_BEFORE`, `CONTEXT_AFTER`) | `join.rs` spacing and punctuation at the seam |

Both skip secure fields (`AXSecureTextField`) and the terminal bundles in `CLIPBOARD_ONLY_BUNDLES`, whose Accessibility text is scrollback, not the input. Voicebox's own window is skipped for the key-down read. Nothing after the caret is read at key-down, nor the selected text in a dictation take (it is read only for Command Mode), nor the window title, the page URL, or any other text on screen. `wake_electron` turns on an Electron app's accessibility tree at key-down, so Slack or VS Code fields become readable by insertion time. The key-down read has no bench of its own; `insert_bench::caret_context_bench` measures the join read in TextEdit (about a millisecond).

### Using it (Python)

- `capture_stream.StreamingCapture.set_context` keeps the last 600 characters (`FIELD_CONTEXT_CHARS`) and sets `continues = phrase_seams.continues_sentence(before)`: true when the text ends in a letter, digit, comma, semicolon or dash with no line break after it.
- **Whisper.** `recognize` passes `previous_text = self.heard or (self.field_before if self.continues else "")`, cut to 600 characters (`PHRASE_CONTEXT_CHARS`), which `mlx_backend._transcribe` sets as `initial_prompt`. So the field's text reaches Whisper only for the first phrase, and only when the take continues a sentence. After a finished sentence ("Thanks.") or in an empty field, Whisper gets no prompt at all. `reconcile_full_audio` follows the same rule.
- **First word's case.** `continue_phrase` lowercases a common first word, keeping names found by `mid_sentence_capitals` in the field text, the phrase, and `known_names()` (500 recent cleanups and corrections, cached five minutes). Cleanup's first word then follows the transcript (`match_raw_start`).
- **Cleanup.** The LLM never sees the field. Its input is the transcript alone, after a cached system prompt and examples (`refinement._prompt`, prefilled per style while the user speaks by `prefill_cleanup`).
- **Privacy.** The field text lives only on the streaming session. It is not saved on the capture, not logged, and not used for learning.
- **Timing.** The backend doesn't wait for the context. `routes/capture_stream.py` applies it when it arrives; a first phrase recognized before it would go without. In practice the first cut is at a pause, well after a millisecond-scale AX read.

The other safeguards that matter here: `content_check.py` rejects a cleanup that adds several content words nobody said, the prompt tells the model never to copy words from the examples, and the small-model note in `refinement.py` records that inline examples made 0.6B echo them. Any context shown to a model has to live with these.

## What the platform and models allow

### Wispr Flow

Flow's Context Awareness reads app info, the text box before, inside and after the selection, on-screen text, variable and file names in coding apps (Cursor, Windsurf, VS Code), the user's identity in the app, the apps in the session, a screenshot, and conversation history. It uses them for recipient names, proper nouns on screen, and matching the field's formatting and tone, and it groups apps into email, work chat, personal chat and other, telling sites apart inside a browser. It never reads password fields, skips numeric-only fields, URL bars, banking apps and its own window, and skips context entirely when reading it would be slow. All of this goes to a cloud model; the bar for Voicebox is doing the useful part locally, within its latency.

### macOS Accessibility

- **Field text.** `AXValue`, `AXNumberOfCharacters`, `AXSelectedTextRange`, `AXSelectedText`, and the parameterized `AXStringForRange`, `AXRangeForLine`, `AXLineForIndex`. Reading a bounded range is cheaper than `AXValue` on a long document, which the code already does.
- **Visible text.** `AXVisibleCharacterRange` gives the part of a long field on screen: a better window than "600 units before the caret" in a long document, where the caret's paragraph may be far from the names in view. Not every app implements it correctly (Ghostty's issue #9932 is one example).
- **Web and Chromium.** Chrome and Safari fields answer the range attributes in most plain fields, but some contenteditable editors (Gmail, Notion-like editors) answer only the text-marker API: `AXSelectedTextMarkerRange`, `AXStringForTextMarkerRange`, `AXTextMarkerRangeForUIElement`. The window's `AXWebArea` has `AXURL`, and document apps expose `AXDocument` on the window. Reported text reads in Chrome take about 10–20 ms, slower on huge pages.
- **Around the field.** `AXFocusedWindow` → `AXTitle` is one cheap call and often carries the recipient, channel or file ("#design – Acme – Slack", "Re: Q3 budget", "auth.ts — voicebox"). The rest of the window (the message being replied to, a thread, a code editor's other lines) is reachable only by walking the tree for `AXStaticText` / `AXTextArea` values, which costs one IPC per element and can run to hundreds of milliseconds in Chromium. `AXUIElementSetMessagingTimeout` bounds each call, not the walk; the walk needs its own budget.
- **Electron.** Slack, VS Code, Discord and similar need `AXManualAccessibility`, already set by `wake_electron`. The first read right after waking can come back empty while the tree builds.
- **Terminals.** Their AX text is scrollback. That is why they are excluded from continuation, and the reason doesn't apply to vocabulary: the command and file names on screen are exactly the identifiers a user dictates in a terminal. Scrollback also holds secrets (tokens, keys), so it must be filtered (below).
- **Screen OCR** (Vision's text recognition on a window capture) reaches what AX can't (canvas apps, images), at the price of the Screen Recording permission and roughly 100–300 ms per window. It is a fallback to consider only if AX coverage proves too thin in the apps the user actually dictates into.

### Whisper prompting

- `initial_prompt` is treated as the previous transcript, not as instructions. It biases spelling of names and terms in it, and the style (casing, punctuation) of what follows; it cannot override what the audio clearly says, and short or unusual-style prompts are weak.
- Only the last ~224 tokens count, and the end of the prompt weighs most. Vocabulary belongs near the end; the continued sentence, if any, belongs at the very end, since it is what the first words must attach to.
- Prompts raise hallucination risk: Whisper can repeat prompt text, especially on short, quiet or trailing audio. A list of unrelated distractor terms can also pull a similar-sounding word toward the wrong term. Research on biasing lists (CB-Whisper, TCPGen, the "Improving rare-word recognition in zero-shot settings" paper) finds prompt biasing helps rare words but degrades as the list grows and fills with distractors; the strong results come from decoder-level biasing (a prefix trie over the bias words with a bounded score bonus, falling back when unconfident) or fine-tuning, not longer prompts.
- Cost: the prompt adds decoder prefill tokens, one parallel pass, small next to the encoder on large-v3-turbo's four decoder layers. It has to be measured, not assumed.

## Options, ranked

Ranked by expected quality gain per unit of risk and latency. All of them are general rules over text; none is keyed to an app, except where flagged.

### 1. A context vocabulary, extracted once at key-down

Everything below uses the same small object: the distinctive words near the caret. Build it in Rust or Python from whatever context arrived, with one rule: keep a word if it is capitalized mid-sentence (the existing `mid_sentence_capitals`), has inner capitals, digits, dots, underscores or slashes (`getUserById`, `v2.3`, `src/app`, `snake_case`), or is not a common word by `phrase_seams._common_word`. Drop anything that looks like a secret: long runs with mixed letters and digits and no vowel structure, anything over ~40 characters, anything that looks like a URL query or key. Whisper couldn't produce those from speech anyway, so nothing of value is lost. Rank by nearness to the caret, and cap at ~40 terms.

Benefit: the foundation for 2–4. Cost: microseconds. It is transient, like the field text itself.

### 2. Snap transcript words to context spellings, deterministically

After Whisper, before cleanup, replace words in the transcript with a context term when they are the same word written differently. Two rules, both exact:

- **Same letters.** A word or run of up to four words whose letters and digits, casefolded, equal a context term's: "github" → "GitHub", "get user by id" → `getUserById`, "use effect" → `useEffect`, "v two point three" is out (spoken numbers are not letters). Only when the context term is distinctive (rule 1), so "Mark" in the field doesn't capitalize "mark the date".
- **Same sound, later.** A capitalized transcript word that isn't a common word and whose phonetic key (Double Metaphone) and edit distance match exactly one context name: "Shawn" → "Sean", "Kate" → "Cate". Riskier; ship behind the eval in "Measuring" and only for names, never common words.

Benefit: names and identifiers already on screen come out right, independent of the model size, with no prompt risk and no latency. This is the rule the correction-learning layer (CORRECTION_LEARNING.md) applies to learned vocabulary, fed from the field instead of history. The content check keeps passing: the tokens compare equal after its normalization, or differ by one word the user can see was on screen.

Failure modes: joining words that were meant separately. "git hub" becoming `GitHub` is what the user meant; "use effect" becoming `useEffect` in a sentence about using an effect is not. Limit the multi-word rule to terms with inner capitals or separators, so an ordinary word in the field never glues words together.

### 3. Always give Whisper a prompt built from the context

Change the Whisper prompt from "the field's sentence, only when continuing" to a composed prompt within ~200 tokens:

```
<up to ~60 tokens of context vocabulary, as a plain sentence-like list, ending with a period>
<the last one or two sentences before the caret, when there are any>
```

When the take continues a sentence, the field's open sentence stays last, exactly as today. When it doesn't, the prompt ends with the field's finished sentence (or the vocabulary line's period), so Whisper starts a sentence and the first-word capital stays right. Later phrases keep today's `heard` text at the end, with the vocabulary line in front of it.

Benefit: the one place the audio itself is re-decoded with the right spelling in mind, which covers words that option 2 can't reach (a misheard name that isn't letter-equal or phonetically close enough). It also carries the field's style, such as a lowercase Slack channel, into the transcript.

Latency: tens of extra decoder-prefill tokens per phrase; measure it with the streaming benchmark. Hidden entirely if under ~10 ms per phrase, since phrases are recognized while the user speaks and only the last one is after release.

Failure modes and guards:
- **Prompt leak.** Whisper repeats the prompt. Guard with a general rule: if the output contains a run of five or more words, or a whole list of three or more vocabulary terms, that appears verbatim in the prompt, decode that phrase again without the vocabulary line and keep the second result. This costs a second decode only when it fires. Keep `check_speech` and the existing ellipsis suppression; never prompt a phrase the speech detector didn't hear.
- **Distractors.** A long list of unrelated terms bends similar-sounding words. Keep the list short and nearest-first, and measure with distractor-only contexts (below).
- **First-word casing.** A vocabulary line that ends without a period would read as an open sentence. Always end it with one.

### 4. Read more context, in two stages, without delaying anything

Today's read stays the first stage. Add a second one, run right after it on the same blocking task, with a hard budget:

1. **Fast (≤ ~20 ms, as today):** 600 units before the caret, plus up to ~200 after it and the selection, and the focused window's `AXTitle`. When the field has `AXVisibleCharacterRange`, read the visible range instead of a fixed window if it's larger.
2. **Slow (budget ~150 ms, abandon past it):** a breadth-first walk of the focused window for text elements, collecting at most ~2,000 characters, nearest to the focused field first, skipping secure fields and the field itself. This reaches the message being replied to and the thread's names. Where the plain range calls fail in a web field, try the text-marker attributes before giving up.

Send each stage as its own message (`context` gets optional `after`, `title`, `window_text` fields; old servers ignore them). The backend uses whatever has arrived when it needs it: the first phrase's recognition takes what's there, and the vocabulary can still grow before later phrases and before cleanup. The user is always speaking for at least a second after key-down, so the budget fits inside the recording; the microphone never waits on it, the same way `set_focus` works now.

Privacy: add `AXSearchField` and fields whose value is purely numeric to the skip rules, next to secure fields. Do not read Voicebox's own window. Terminals may contribute vocabulary (filtered by the secret rule) but still never continuation. Nothing from either stage is written to disk, logged, or stored on the capture.

Flag: the tree walk is general, but its cost varies a lot by app. If one app's tree is pathologically slow, the budget handles it; don't add per-app skip lists unless a measurement shows the budget alone isn't enough.

### 5. Give cleanup the context, carefully, and prefill it while the user speaks

Cleanup would benefit from knowing the reply context (the question being answered makes "yeah that works for thursday" read correctly) and the vocabulary. It is also where the risk is highest: small Qwen models copy text they are shown, which is why examples went into chat turns and why the content check exists.

If tried, give the model only:
- the context vocabulary as a short "Spellings: A, B, C." line, and
- at most the last sentence before the caret, labelled as text that is already written,

in the user turn, before the transcript, and with the existing "never copy" instruction extended to it. That keeps the cached system prompt and examples valid (`prompt_cache_key` is per style). The context block is known at key-down, so a variant of `prefill_cleanup` can put the system prompt, examples and the context block in the cache while the user speaks; after release only the transcript is new, so the added tokens cost nothing at release.

Expected benefit is modest once options 2 and 3 exist: most of the vocabulary value is already captured deterministically. Try it on 1.7B and 4B first, and keep it only if the evals below show fewer corrections with no rise in content-check rejections or reviews. Tone from the reply context stays with per-app styles (PER_APP_STYLE.md), which already express it without showing the model private text.

### 6. Decoder-level biasing (later)

The published approaches that scale are a trie over the bias terms with a bounded bonus on their tokens during decoding, backing off when Whisper is unconfident. That avoids prompt leakage entirely and survives long lists. It needs a logit hook in the MLX Whisper decode loop and its own evaluation, so it belongs after 1–4 have shown how much of the gap is left.

### Not recommended

- Showing Whisper the raw window text. Long, unrelated prompts are the documented cause of Whisper hallucinations, and the 224-token window would be spent on the wrong words.
- Letting the LLM decide which nearby words to use. The deterministic rules above decide the same thing without tokens or copying risk.
- Storing context on captures for learning. MID_SENTENCE_DICTATION.md proposed it; for vocabulary it isn't needed, since option 2's result is visible in the captured transcript, and keeping message text around widens what a local database holds. If evals need real context, record it only in an explicit, off-by-default debug mode.

## Measuring

- **Read cost (Rust).** Extend `insert_bench.rs` beside `caret_context_bench` with one bench per stage (fast read, title, visible range, tree walk) in TextEdit, Mail, Notes, Safari and Chrome (a Gmail-like contenteditable), Slack and VS Code. Report p50 and p95; stage 2 must stay inside its budget at p95.
- **Recognition and end-to-end latency.** `scripts/benchmark-streaming-dictation.py` replays `say`-generated fixtures through the real `StreamingCapture`. Add a context argument and three fixture sets: context that contains the rare names and identifiers spoken (the gain), unrelated context full of similar-sounding distractors (the harm), and short or near-silent takes with a long context (the leak). Its WER ignores casing and identifiers, so add an exact-match recall for the fixture's rare terms and a count of prompt words that appear in output but not in the reference. Report stop-to-output time with and without context.
- **Cleanup.** Run `backend/tests/test_refinement_samples.py` with and without the context block, and the model-improvement gates (`model_improvement/evaluation.py`: no row regresses, `preserves_facts`) on the same rows. Track content-check verdicts: a rise in `review` or `reject` means the model is copying.
- **Unit tests.** `backend/tests/test_capture_stream_context.py` and `test_phrase_seams.py` for the vocabulary extraction, the snapping rules (including the negatives: "mark the date" with "Mark" in the field, "use effect" as plain words), the composed prompt's ending, and the leak-retry rule.
- **Daily use.** The correction rate in the Captures tab for names and identifiers, before and after, in the apps the user dictates into.

## Order

1. Context vocabulary and same-letter snapping (options 1 and 2). No model changes, no latency, measurable on day one.
2. The composed Whisper prompt with the leak guard (option 3), gated on the three benchmark sets.
3. The second read stage and the extra fields (option 4); the vocabulary gets better without changing 1–3.
4. Cleanup context with prefill (option 5), kept only if the evals say so.
5. Decoder-level biasing (option 6), if names are still misheard after all of the above.

## Sources

- [Wispr Flow: Context Awareness](https://docs.wisprflow.ai/articles/4678293671-Context-Awareness)
- [OpenAI: Whisper prompting guide](https://developers.openai.com/cookbook/examples/whisper_prompting_guide)
- [Contextual biasing of Whisper without fine-tuning (TCPGen)](https://arxiv.org/html/2410.18363v1)
- [Improving rare-word recognition of Whisper in zero-shot settings](https://arxiv.org/abs/2502.11572)
- [CB-Whisper: contextual biasing using open-vocabulary keyword spotting](https://aclanthology.org/2024.lrec-main.262/)
- [Apple: AXUIElementSetMessagingTimeout](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout)
- [Ghostty #9932: AXVisibleCharacterRange returns wrong data](https://github.com/ghostty-org/ghostty/issues/9932)
- [Reading web-field carets with the text-marker API in Chrome](https://github.com/uttrflow/uttrflow-swift/pull/2205)

# Read Aloud

## Problem

Kass turns speech into text but never the reverse. Hearing text instead of reading it (a long message, a page you're proofreading, your own draft) means copying it into another app. Read Aloud does it in place: select text in any app, press a key, and Kass reads it to you in a natural voice, on the Mac.

## Flow

```
press read-aloud chord ──► already speaking? stop, done
                       ──► focus snapshot, then the selection is read (Command Mode's reader)
                             none ──► pill says "Select text to read aloud first"
                       ──► pill shows Speaking
                       ──► text split into sentences
                       ──► for each sentence: server synthesizes it (Kokoro on MLX), Rust plays it,
                           and the next one is synthesized while this one plays
end of text, chord again, Escape, or a dictation starting ──► playback stops, pill hides
```

### 1. Chord

A fourth chord, `chord_speak_keys` in capture settings, edited with the same `ChordPicker` as the others. It is a press, not a hold: press to start, press again to stop. An empty chord turns Read Aloud off. Default: right ⌥ + right ⇧, which shares no chord with dictation (right ⌘ + right ⌥, plus Space for toggle) or Command Mode (right ⌘ + right ⇧).

`hotkey_monitor` gets a `ChordAction::Speak`. Unlike the other chords it never opens the microphone: its Start runs `read_aloud::toggle`, and its End does nothing. The dictation gate (models still downloading) applies to it like every chord.

### 2. Reading the selection

Command Mode's reader (`dictation::command::read_selection`): Accessibility first, ⌘C with clipboard restore when Accessibility can't say. One difference: terminals and `CLIPBOARD_ONLY_BUNDLES` are declined for Command Mode because their selection can't be replaced, but reading it is fine, so Read Aloud reads them through ⌘C. Secure text fields are still refused.

Selections are capped at `MAX_SELECTION_CHARS` (16,000), as for commands.

### 3. Server

- **Model.** Kokoro 82M, `mlx-community/Kokoro-82M-bf16` (345 MB), registered as a `ModelConfig` with engine `kokoro`, so the Models tab downloads, shows and deletes it like Whisper and Qwen. Not downloaded until the user turns Read Aloud on or presses the chord; a missing model ends with "Download Kokoro in Models" like Command Mode's missing-model message.
- **Runtime.** mlx-audio's Kokoro pipeline, already bundled for Whisper. Its English phonemizer (misaki) needs spaCy with `en_core_web_sm`, eSpeak NG and num2words, which Kass dropped with Voicebox's text-to-speech; they come back in `requirements.txt` (installed `--no-deps`, like mlx-audio, so misaki doesn't pull torch) and in the PyInstaller build, with package metadata, because misaki calls `spacy.util.is_package` and would otherwise try to download the model at runtime.
- **MLX queue.** Synthesis runs on the one MLX thread with Whisper and Qwen. One sentence is one job (about 0.2 s warm for five seconds of speech), so a dictation started while Kass is reading waits at most one sentence. A dictation starting stops playback anyway.
- **Warm-up.** The first synthesis after loading takes several seconds (pipeline and phonemizer setup). With Read Aloud on and the model downloaded, startup warms it after Whisper and the cleanup model.
- **API.** `POST /speech` with `{text, voice, speed}` returns one sentence as 24 kHz WAV. `POST /speech/sentences` with `{text}` returns the sentences Kass will read, so Rust can fetch the next while the current one plays. Splitting is on the server, next to the model that reads the sentences.

### 4. Playback (Rust)

A `read_aloud` module owns one player thread. It plays each sentence's WAV with `NSSound` (as the sound cues do), polls for its end, and fetches the next sentence while the current one plays. A generation counter makes stop instant: a stale fetch or a finished sound from an old reading is ignored.

Stops on: the chord pressed again, Escape (the existing escape watcher also calls `read_aloud::stop`), a dictation take starting, or the end of the text. The pill shows `Speaking` for the reading's duration and hides at the end; an error (no selection, model missing, server error) shows in the pill like a command error.

### 5. Settings

A Read Aloud page in Settings, next to Command Mode: the chord (with Turn off), the voice, and the speed. Voices are Kokoro's American and British English ones; default `af_heart`. Stored in capture settings as `chord_speak_keys`, `speak_voice`, `speak_speed`.

**Read naturally** (`speak_naturally`, on by default) reads the selection the way a person would say it (`services/speakable.py`, applied by `/speech/sentences`). Kokoro's phonemizer, misaki, keeps only `; : , . ! ? — …` and quotes as pauses: it reads ` / ` as "slash" in one breath, drops the period after a lettered option ("A. Cut them" is read "A cut them"), and spells out "e.g.". So every symbol the rules remove leaves one of those pauses in its place:

- A slash list in brackets is a list of examples: `(resize / lift / hold)` → `, for example resize, lift, and hold,`; one that trails off (`…`) ends `, and so on`.
- Other brackets are set off by commas; slashes between words are "or".
- A lettered option line (`A.`, `B)`) becomes `Option A:`.
- e.g., i.e., etc., vs., w/, `&` and `->` are said in words; Markdown is read as its text and a URL as its site.
- A line with no closing punctuation, such as a heading or bullet, ends with a period.

Dates and paths (`10/2`, `/usr/bin`) are left alone. Off, the text is read exactly as written. A later step could rewrite with the cleanup model for what fixed rules can't cover.

## Risks

- **App size.** spaCy, its English model, eSpeak NG and misaki add about 95 MB to the bundle.
- **Long text.** 16,000 characters is several minutes of speech; it plays sentence by sentence, so memory stays flat.
- **Pronunciation.** Kokoro reads code literally. Read naturally covers lists, brackets, common symbols, abbreviations, Markdown and URLs.
- **Languages.** English voices only in the first version; other text is read with English pronunciation.

## Not now

Highlighting the word being read, a ⌘K palette entry, reading Kass's own captures aloud, and voices other than Kokoro's built-in ones.

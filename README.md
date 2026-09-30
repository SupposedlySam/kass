<p align="center">
  <img src="docs/assets/icon-dark.webp" alt="Herga" width="120" height="120" />
</p>

<h1 align="center">Herga</h1>

<p align="center">
  <strong>Local dictation for macOS.</strong><br/>
  Hold a hotkey, speak, and get ready-to-send text in your own words, pasted into any app.<br/>
  Everything runs on your Mac.
</p>

<br/>

## What is Herga?

Herga is a local-first dictation app for Apple Silicon Macs. Hold a global hotkey anywhere on your system and speak. When you let go, Whisper transcribes what you said, a local LLM cleans it up, and the result is pasted into the text field you were typing in.

The goal is text you could send as-is while keeping what you meant, in your own words. Refinement removes filler, stutters, false starts and self-corrections. It does not summarize or add anything. Herga also learns from the corrections you make.

The name comes from *jerga*, Spanish for slang: the way you actually talk. Herga started as a fork of [Voicebox](https://github.com/jamiepine/voicebox) by Jamie Pine.

- **Private.** Audio, transcripts, models and everything learned from your corrections stay on your machine. Nothing is hosted.
- **Native.** Built with Tauri (Rust), not Electron. Audio capture, the hotkey, focus tracking and paste run in native code, so they are fast.
- **Apple Silicon.** Whisper and the refinement LLM run on MLX (Metal).

---

## Features

### Guided setup

On first run, onboarding downloads the models in the background while it walks you through permissions, your hotkey, your name and a first dictation. If macOS needs Herga to quit to apply a permission, setup reopens on the same step.

### Global dictation

- **Configurable chords.** You can rebind the hold-to-speak and tap-to-toggle chords in the in-app chord picker. If you tap `Space` while holding push-to-talk, the session switches to toggle mode without dropping any audio. Press `Escape` to cancel a dictation, even while it is still finishing.
- **Native, streaming capture.** The microphone is captured in Rust and streamed to the local server while you speak, and cleanup runs one sentence at a time, so there is little left to do when you let go. You can choose the input device. The microphone is released after every dictation.
- **Text lands where you were typing.** Text is inserted into the field that had focus when you started. Herga uses Accessibility, typed keystrokes or the clipboard, depending on what the app supports. When it has to use the clipboard, it puts your clipboard contents back afterwards.
- **On-screen pill.** A floating overlay on the display you are using shows recording, transcribing and refining, and shows the active writing style. It never takes keyboard focus. Sound cues mark start, stop and errors.
- **Spoken commands.** You can say line breaks, lists, quotes, brackets, braces, slashes, pipes and carets. You can spell words letter by letter ("capital C…"), or say "paste from clipboard" to insert what you copied.
- **Launch at login.** Herga starts hidden at login. This is on by default and can be turned off in Settings.

### Speech-to-text

Transcription uses OpenAI Whisper on MLX. The same model handles dictation, the Captures tab and the `/transcribe` endpoint. It is loaded at startup, so the first dictation is as fast as the rest. Audio with no voice in it is never transcribed, and Whisper's repeated-phrase loops are removed.

| Size                          | Notes                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| Base / Small / Medium / Large | Standard Whisper quality ladder                             |
| Turbo                         | About 8x faster than Whisper Large with little quality loss |

### Local LLM refinement

A bundled Qwen3 model (0.6B, 1.7B or 4B) cleans up each transcript before it is pasted. It removes filler words, stutters, repeats and false starts, and applies spoken self-corrections ("Tuesday, no actually Wednesday" becomes "Wednesday"). Technical terms are kept exactly as you said them. If the cleanup answers your question instead of writing it down, copies an example, or adds words you didn't say, it is rejected and your own words are pasted instead.

### Writing styles

Each app gets a writing style, and each style learns separately. You can drag apps onto a style, create a style when a new app first shows up, or switch styles by saying so at the start of a dictation ("use formal mode").

A style learns how you write in two ways. You can reply to a few short conversations in your own words, and your later corrections add more evidence. Herga tracks what you do at sentence breaks, with capitalization and with commas. The refinement prompt and a final pass follow those habits, and the final pass only changes punctuation and capitalization, never your words.

### Dictionary

You can add terms and spoken replacements that apply everywhere, in one style, or only in specific apps. To add a word from a capture, select it.

### Command Mode

Select text in any app, hold `right ⌘` + `right ⇧`, and say how you want it rewritten. Polish and Prompt Engineer are included, and you can save your own transforms.

### Captures

Every dictation and uploaded audio file is saved in the Captures tab, grouped by app, with the original audio next to what Whisper heard and the cleaned-up text. A **Check** badge marks cleanups that may need a second look.

- **Replay, re-transcribe, refine.** You can run speech-to-text again with a different Whisper size, or run the raw transcript through the LLM again with different options.
- **Edit and report.** You can fix a transcript in place, or report a wrong transcription or refinement.
- **History retention.** You can choose how long captures are kept. Nothing is deleted until you confirm the first time. What old captures taught Herga is kept after they are deleted.
- **Local storage.** Audio and transcripts stay in your Herga data directory (set `HERGA_DATA_DIR` to change it). Settings has a shortcut that opens that folder.

### Correction learning

A fix you make to a capture takes effect right away. Older fixes are folded into rules by a periodic local job, which keeps a candidate rule only if it does at least as well on your past corrections. You can see what was learned, run the job on demand, or roll back to an earlier set of rules.

### Insights and navigation

- **Insights** shows how many words you dictated, your speaking pace, the time you saved and the apps you use most.
- **Command palette.** Press `⌘K` to jump to any setting or action.

### Model management

- You can download, unload and delete models from the Models tab.
- Set `HERGA_MODELS_DIR` to use a custom models directory. You can also move your models to another folder from within the app, which shows progress while it moves them.

---

## API

The local server listens on `http://127.0.0.1:17493`. Some useful endpoints:

```bash
# Transcribe an audio file
curl -X POST http://127.0.0.1:17493/transcribe \
  -F "file=@recording.wav" \
  -F "model=turbo"

# List captures
curl http://127.0.0.1:17493/captures

# Is the server up?
curl http://127.0.0.1:17493/health
```

Full API documentation is at `http://127.0.0.1:17493/docs` while the server is running.

---

## Tech Stack

| Layer       | Technology                                                                  |
| ----------- | --------------------------------------------------------------------------- |
| Desktop app | Tauri (Rust)                                                                |
| Native shim | Rust: audio capture, global hotkey, focus introspection, paste injection    |
| Frontend    | React, TypeScript, Tailwind CSS, Zustand, React Query                       |
| Backend     | FastAPI (Python), bundled as a sidecar binary                               |
| STT         | Whisper / Whisper Turbo on MLX                                              |
| Local LLM   | Qwen3 (0.6B / 1.7B / 4B) on MLX                                             |
| Database    | SQLite                                                                      |

---

## Development

### Quick Start

```bash
just setup   # creates the Python venv and installs all dependencies
just dev     # starts the backend and the desktop app
```

To install [just](https://github.com/casey/just), run `brew install just`. Run `just --list` to see every command.

**Prerequisites:** an Apple Silicon Mac, [Bun](https://bun.sh), [Rust](https://rustup.rs), [Python 3.12](https://python.org), [Xcode](https://developer.apple.com/xcode/), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Installing and Updating

Download the latest DMG from [Releases](https://github.com/mrgnhnt96/herga/releases/latest), or read the docs at [herga.mrgnhnt.com](https://herga.mrgnhnt.com/docs/). To build and install from this checkout instead:

```bash
./scripts/install.sh   # or: just install
```

The script checks for everything the build needs and prints the command to install anything missing. It then pulls the latest code, builds the server (only when the backend changed) and the app, and replaces `/Applications/Herga.app`. Run it again to update.

Every build is signed with the same identity, so updates keep Herga's Microphone, Accessibility and Input Monitoring permissions. That identity is your Apple Development certificate if you have one. Otherwise the first install creates a self-signed "Herga Local Signing" certificate, and macOS asks for your password once to trust it for code signing. If a Mac's current install was signed another way, macOS asks for the permissions once more after the switch.

`just build` builds the same signed app without installing it. The bundle is written to `tauri/src-tauri/target/release/bundle/`.

### Checks and Tests

```bash
just check   # lint, format-check and typecheck the frontend and backend
just test    # run the backend tests
```

### Releasing

Move the Unreleased notes in [CHANGELOG.md](CHANGELOG.md) (which the website also shows) under the new version, commit, then from a clean `main`:

```bash
./scripts/release.sh 0.6.0
```

This sets the version everywhere, commits, tags `v0.6.0` and pushes. The tag starts `.github/workflows/release.yml`, which builds the app and publishes a GitHub release with the DMG attached. The app checks that release to let people know an update is available.

### Project Structure

```
herga/
├── app/              # React frontend
├── tauri/            # Desktop shell (Tauri + Rust native dictation code)
├── backend/          # Python FastAPI server (STT, refinement, captures, learning)
├── docs/             # Plans and project status
├── site/             # Website: landing page, docs and changelog (herga.mrgnhnt.com)
└── scripts/          # Build scripts
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.

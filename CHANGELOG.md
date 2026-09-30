# Changelog

Notable changes to Herga for users. Each release gets a section here, newest first. The website shows this file at [herga.mrgnhnt.com/changelog](https://herga.mrgnhnt.com/changelog/).

## Unreleased

The first release of Herga as a dictation app. This fork of [jamiepine/voicebox](https://github.com/jamiepine/voicebox) 0.5.0 drops text-to-speech and focuses entirely on turning your speech into ready-to-send text on Apple Silicon Macs.

**Voicebox is now Herga**, from *jerga*, Spanish for slang. Your captures, styles, dictionary and settings carry over the first time Herga opens. macOS treats it as a new app, so it asks for Microphone, Accessibility and Input Monitoring once more. The old Voicebox.app can go in the Trash; the install script does that for you.

### New

- **Guided setup.** First-run onboarding downloads the models in the background while it walks you through permissions, your hotkey, your name and a first messy dictation. If macOS needs Herga to quit for a permission, setup reopens on the same step.
- **Native, streaming dictation.** The microphone is captured in native code and streamed while you speak, and cleanup runs a sentence at a time, so there's less to wait for when you let go.
- **Text lands where you were typing.** Text is inserted through Accessibility, typed keystrokes or the clipboard, whichever works for the app. When it has to use the clipboard, it puts yours back.
- **Writing styles per app.** Every app gets a style, and each style learns on its own. Switch style by saying so at the start of a dictation ("use formal mode"). The pill shows the style's name and plays a sound when it changes.
- **Teach by replying.** Teach a style how you write by replying to a few short conversations.
- **Dictionary.** Add terms and spoken replacements for everywhere, a style or specific apps. Select a word in a capture to add it.
- **Command Mode.** Select text in any app, hold <kbd>right ⌘</kbd> + <kbd>right ⇧</kbd> and say how to rewrite it. It comes with the Polish and Prompt Engineer transforms, and you can save your own.
- **Spoken commands.** Say line breaks, lists, quotes, brackets, braces, slashes, pipes and carets. Spell things out letter by letter ("capital C…"). Say "paste from clipboard" to insert your clipboard.
- **Self-corrections.** "Tuesday, no actually Wednesday" becomes "Wednesday". Repeats, stutters and restarts are removed.
- **Correction learning.** Fix a capture and the fix is used right away. Older fixes are folded into rules, which are kept only if they do at least as well on your past corrections.
- **Captures redesign.** Captures are grouped by app and show the audio next to what Whisper heard and the cleaned-up text. A **Check** badge flags cleanups worth a second look.
- **Insights.** See words dictated, speaking pace, time saved and your most-used apps.
- **History retention.** Choose how long to keep captures. Nothing is deleted until you confirm.
- **Escape to cancel** a dictation, even while it's still finishing.
- **Sound cues** for start, stop and errors, with a volume setting.
- **Launch at login**, on by default, with the window hidden.
- **Command palette.** Press <kbd>⌘</kbd> <kbd>K</kbd> to jump to any setting or action.

### Improved

- After an update, Herga replaces a local server still running from the old version instead of reusing it, so the new version's backend is always the one running.
- Model weights stay loaded between dictations, and the first dictation after launch is as fast as the rest.
- The pill shows on the display you're working on, shows recording as soon as you press the keys, and never takes keyboard focus.
- Audio without a voice in it is never transcribed, and Whisper's repeated-phrase loops are removed.
- Cleanup is rejected and your own words are used instead when it answers your question instead of writing it down, copies an example, or adds words you didn't say.
- The microphone is released after every dictation.

### Removed

- Text-to-speech, voice profiles and cloning, stories, effects, the MCP server, and Herga Cloud.
- Support for Windows, Linux and Intel Macs. Herga now runs only on Apple Silicon.

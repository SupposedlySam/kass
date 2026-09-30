# Onboarding

First-run onboarding in its own window, in the approved "Poster" design: one
bold color per step, giant type, the user's own words as the picture, and no
visible checklist. The prototype is the "Poster · Interactive prototype" board
on the onboarding designs canvas.

## Flow

1. **Welcome.** One sentence on what Herga does. Everything stays on this Mac.
2. **Download the models.** Speech to text first, then cleanup. One button
   starts both. Downloads keep going through every later step, and restart by
   themselves after a relaunch (Input Monitoring forces one).
3. **Input Monitoring.** Warns first that macOS will ask to quit Herga and
   that onboarding reopens on this step. Back from the relaunch, the step
   shows a green success card and a "Try it now" button that has the user hold
   the dictation keys (practice mode: nothing records).
4. **Accessibility.** No quit. Green success card when the switch is on.
5. **Microphone.** Asks for the microphone, then shows a live level meter and
   the microphone picker.
6. **Keys + launch at login.** Big keycaps that sink while the real chord is
   held (practice mode). "Enable" button for launch at login. Small text: the
   keys can be changed in Settings.
7. **Say your name.** The first real dictation, into a focused field. Then "Is
   that spelled right?": "Yes, that's me" or "Fix the spelling" (edit in place).
   The confirmed spelling is saved to the dictionary (with what was heard as
   the spoken form when it was fixed).
8. **Talk messy.** Three scripted lines to read out loud. Shows what was heard
   (raw) next to what was sent (cleaned).
9. **Rewrite a selection.** A paragraph is selected in a text box. Hold the
   command keys (right ⌘ + right ⇧ by default) and say an instruction, or click
   one. The text changes in place, with Undo.
10. **You're set.** "Go talk." The three shortcuts. "Start using Herga"
    closes onboarding and shows the main window; "Show me now" opens
    Settings › Features.

## Rules

- **Speech needs both models.** Steps 7 to 9 are hard-locked until
  `canRecord`'s model gates are green (speech, and cleanup when auto-refine is
  on). A locked step shows the progress and "Herga can't hear you until this
  finishes". The chord is armed as soon as Input Monitoring is granted; while
  the models are missing, a chord press shows "Still downloading" in the pill
  instead of recording (the dictation gate).
- **Resume.** The current step and "downloads started" are kept in
  localStorage (`herga.onboarding`). Onboarding reopens on that step after a
  quit. Downloads that were started and aren't finished or running are started
  again on open.
- **Download failures.** An errored download task is shown with its reason,
  retried by itself up to three times (with a pause), and then offers "Try
  again now" and "Use a smaller model" (`small` Whisper). Before starting,
  free disk space is checked against the model sizes.
- **Who owns the chord.** While onboarding isn't completed, the onboarding
  window arms the chord and sets the dictation gate; the main window's chord
  sync is paused, and it refetches everything when onboarding finishes.
- **The chord is armed once Input Monitoring is on,** in the main window too:
  missing models no longer disarm it. They set the dictation gate, so a press
  says "Still downloading" instead of doing nothing.
- **Existing installs** never see onboarding: the migration that adds
  `capture_settings.onboarding_completed` sets it for databases that already
  have captures or an enabled shortcut.

## Rust contract

Window:

- `open_onboarding()`: build (once) and show the `onboarding` window
  (`?view=onboarding`, 880×600, fixed size, overlay title bar, centered),
  focus it and hide the main window.
- `finish_onboarding(show: Option<String>)`: close the onboarding window, show
  and focus the main window, emit `onboarding:finished { show }` (a route to
  open, or null).
- `onboarding_window_open() -> bool`.
- Closing the onboarding window with its close button does the same as
  `finish_onboarding(None)`. Either way, closing turns chord practice off and
  stops any microphone preview (the window's own cleanup may not run). Only the main window runs the close-to-stop-server
  flow. A Dock click with no visible window shows onboarding when it exists.

Chords:

- Events to all windows on chord start/stop: `chord:down { action }` and
  `chord:up { action }`, `action` = `push_to_talk | toggle_to_talk | command`.
- `set_chord_practice(enabled: bool)`: while on, chords only emit events.
- `set_dictation_gate(blocked: Option<String>)`: while set, a chord that would
  start a take shows the message in the pill instead (a notice) and records
  nothing.

Dictation into Herga windows:

- `dictation:insert` goes to the focused Herga window (onboarding or
  main), not always main.
- A command take whose target is a Herga window asks that window for its
  selection: `dictation:selection-request { take }` → reply
  `dictation:selection { take, text }` (1 s timeout, then "Select text to
  rewrite first"). The rewrite is delivered through `dictation:insert`, which
  replaces the selection.

Microphone:

- `microphone_permission() -> "granted" | "denied" | "restricted" | "undetermined"`.
- `mic_preview_start(device_id: Option<String>)` opens the microphone (this
  shows the macOS prompt when undetermined) and emits `mic:level { db }` about
  every 50 ms; `mic:error { message }` on failure. Refused while a take
  records. `mic_preview_stop()`.

## Backend

- `capture_settings.onboarding_completed` (bool, default false; migration sets
  true for existing installs). Set when onboarding is finished. Closing the
  window early leaves it unset, so onboarding opens again, on the saved step,
  at the next launch.
- Whisper model configs report `size_mb`.
- `GET /models/disk-space` → `{ free_mb }` for the model cache's volume.

## Not in this build

The "when it's useful" tips after onboarding (first dictation in a new app,
first edit of a capture, and so on) and the Features page's done-marks.

## Where it lives

- Window and steps: `app/src/components/Onboarding/` (`OnboardingWindow.tsx`,
  `steps/`, `onboardingFlow.ts` for the order and rules, tested in
  `app/tests/onboarding-flow.test.ts`).
- The main window opens it (`useOnboardingLauncher`); `/setup`, ⌘K "Open
  onboarding" and Settings › Features open it again. The web build has no
  windows and keeps the old setup page.
- Settings › Features: `app/src/components/Settings/FeaturesPage.tsx`.
- Rust: `open_onboarding` / `finish_onboarding` in `main.rs`, chord events,
  practice and the gate in `hotkey_monitor.rs`, the microphone preview in
  `dictation/mic.rs`.

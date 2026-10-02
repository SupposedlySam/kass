//! Read Aloud (docs/plans/READ_ALOUD.md): the selected text, spoken.
//!
//! Its chord's press toggles a reading. The selection is read like Command
//! Mode's, the server splits it into sentences, and each sentence's audio is
//! played with `NSSound` while the next one is fetched. A reading stops at
//! its end, at the chord pressed again, at Escape, or when a dictation
//! starts. A generation number makes stopping instant: whatever an old
//! reading still has in flight sees a newer generation and does nothing.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::dictation::take::PillEvent;
use crate::dictation::{http, DictationState};
use crate::focus_capture::FocusSnapshot;
use crate::text_insert::SelectionRead;

pub const NO_SELECTION_MESSAGE: &str = "Select text to read aloud first";
pub const NOT_READABLE_MESSAGE: &str = "This text can't be read aloud";
pub const IN_KASS_MESSAGE: &str = "Read Aloud reads text in other apps";

/// How often playback checks whether a sentence has finished or was stopped.
const POLL: Duration = Duration::from_millis(30);

/// The reading that's allowed to act. Every start and stop moves it on.
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// The generation of the reading in progress, or 0 when none is.
static SPEAKING: AtomicU64 = AtomicU64::new(0);

fn is_current(generation: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) == generation
}

/// The chord was pressed: stop the reading in progress, or start one.
pub fn toggle(app: &AppHandle) {
    if !stop(app) {
        start(app);
    }
}

/// Stop the reading in progress. Returns whether there was one.
pub fn stop(app: &AppHandle) -> bool {
    let speaking = SPEAKING.swap(0, Ordering::SeqCst);
    if speaking == 0 {
        return false;
    }
    GENERATION.fetch_add(1, Ordering::SeqCst);
    emit(app, speaking, PillEvent::Cancelled);
    eprintln!("[read-aloud] stopped");
    true
}

fn start(app: &AppHandle) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // The pill's events share the takes' ids so they never clash.
    let take_id = app.state::<DictationState>().next_take_id();
    SPEAKING.store(take_id, Ordering::SeqCst);
    // Before the pill is shown, so the snapshot is the app the user is in.
    let focus = crate::focus_capture::capture_focus().ok();
    crate::dictation::show_hud(app);
    emit(app, take_id, PillEvent::Speaking);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let event = read(&app, generation, focus).await;
        // Only the reading still in progress ends itself; a stopped one already hid the pill.
        if is_current(generation) && SPEAKING.compare_exchange(take_id, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok()
        {
            emit(&app, take_id, event);
        }
    });
}

/// Read the selection aloud. Returns how the pill should end.
async fn read(app: &AppHandle, generation: u64, focus: Option<FocusSnapshot>) -> PillEvent {
    let Some(focus) = focus else {
        return PillEvent::notice(NO_SELECTION_MESSAGE);
    };
    let started = Instant::now();
    let selection = tauri::async_runtime::spawn_blocking(move || read_selection(&focus)).await;
    let text = match selection {
        Ok(Ok(text)) => text,
        Ok(Err(message)) => return PillEvent::notice(message),
        Err(e) => return PillEvent::error(e.to_string()),
    };
    let (server_url, client) = app.state::<DictationState>().server();
    let sentences = match http::speech_sentences(&client, &server_url, &text).await {
        Ok(sentences) => sentences,
        Err(message) => return PillEvent::error(message),
    };
    eprintln!(
        "[read-aloud] {} chars in {} pieces, read in {:.0}ms",
        text.chars().count(),
        sentences.len(),
        started.elapsed().as_secs_f64() * 1000.0
    );

    let fetch = |sentence: String| {
        let (client, server_url) = (client.clone(), server_url.clone());
        tauri::async_runtime::spawn(async move { http::speech(&client, &server_url, &sentence).await })
    };
    let mut pieces = sentences.into_iter();
    let mut next = pieces.next().map(fetch);
    let mut first = true;
    while let Some(pending) = next.take() {
        let audio = match pending.await {
            Ok(Ok(audio)) => audio,
            Ok(Err(message)) => return PillEvent::error(message),
            Err(e) => return PillEvent::error(e.to_string()),
        };
        if !is_current(generation) {
            return PillEvent::Cancelled;
        }
        if first {
            eprintln!(
                "[read-aloud] first sound {:.0}ms after the chord",
                started.elapsed().as_secs_f64() * 1000.0
            );
            first = false;
        }
        // The next piece is synthesized while this one plays.
        next = pieces.next().map(fetch);
        let played = tauri::async_runtime::spawn_blocking(move || play(&audio, generation)).await;
        match played {
            Ok(Ok(())) => {}
            Ok(Err(message)) => return PillEvent::error(message),
            Err(e) => return PillEvent::error(e.to_string()),
        }
        if !is_current(generation) {
            return PillEvent::Cancelled;
        }
    }
    PillEvent::Done
}

/// The selection in the app `focus` names, as Command Mode reads it, except
/// that a terminal's selection is read too: it can't be replaced, but it
/// can be heard. A password field is never read. Blocking.
pub fn read_selection(focus: &FocusSnapshot) -> Result<String, &'static str> {
    if focus.bundle_id.as_deref() == Some(crate::KASS_BUNDLE_ID) {
        return Err(IN_KASS_MESSAGE);
    }
    crate::text_insert::wake_electron(focus.pid);
    // No bundle id: the terminal rule is about writing, not reading.
    let read = crate::text_insert::selection_in_focused(focus.pid, None);
    decide(read, crate::clipboard::copy_selection)
}

/// The text to read, from what Accessibility read and, where it couldn't
/// tell, a copy. `copy` runs only then.
pub fn decide(
    read: SelectionRead,
    copy: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<String, &'static str> {
    let text = match read {
        SelectionRead::Text(text) => text,
        SelectionRead::Empty => return Err(NO_SELECTION_MESSAGE),
        SelectionRead::NotEditable => return Err(NOT_READABLE_MESSAGE),
        SelectionRead::Unreadable => match copy() {
            Ok(Some(text)) => text,
            Ok(None) => return Err(NO_SELECTION_MESSAGE),
            Err(e) => {
                eprintln!("[read-aloud] copying the selection failed: {e}");
                return Err(NO_SELECTION_MESSAGE);
            }
        },
    };
    if text.trim().is_empty() {
        return Err(NO_SELECTION_MESSAGE);
    }
    Ok(text)
}

/// Play one piece of WAV to its end, or until `generation` is no longer the
/// current reading. Blocking.
fn play(wav: &[u8], generation: u64) -> Result<(), String> {
    platform::play(wav, || is_current(generation), POLL)
}

/// The pill's stop button while it shows Speaking.
#[tauri::command]
pub fn read_aloud_stop(app: AppHandle) {
    stop(&app);
}

fn emit(app: &AppHandle, take_id: u64, event: PillEvent) {
    let mut payload = serde_json::to_value(&event).unwrap_or(Value::Null);
    if let Value::Object(ref mut map) = payload {
        map.insert("take".into(), Value::from(take_id));
    }
    let _ = app.emit("dictation:state", payload);
}

#[cfg(target_os = "macos")]
mod platform {
    use std::time::Duration;

    use objc::runtime::{Object, BOOL, NO};
    use objc::{class, msg_send, sel, sel_impl};

    type Id = *mut Object;

    /// Play `wav` with `NSSound`, which follows the current output device,
    /// polling every `poll` until it ends or `keep_going` says to stop.
    pub fn play(wav: &[u8], keep_going: impl Fn() -> bool, poll: Duration) -> Result<(), String> {
        unsafe {
            let pool: Id = msg_send![class!(NSAutoreleasePool), new];
            let data: Id = msg_send![class!(NSData), dataWithBytes: wav.as_ptr() length: wav.len()];
            let sound: Id = msg_send![class!(NSSound), alloc];
            let sound: Id = msg_send![sound, initWithData: data];
            if sound.is_null() {
                let _: () = msg_send![pool, drain];
                return Err("Couldn't play the voice".into());
            }
            let played: BOOL = msg_send![sound, play];
            let result = if played == NO {
                Err("Couldn't play the voice".into())
            } else {
                loop {
                    std::thread::sleep(poll);
                    if !keep_going() {
                        let _: BOOL = msg_send![sound, stop];
                        break Ok(());
                    }
                    let playing: BOOL = msg_send![sound, isPlaying];
                    if playing == NO {
                        break Ok(());
                    }
                }
            };
            let _: () = msg_send![sound, release];
            let _: () = msg_send![pool, drain];
            result
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::time::Duration;

    pub fn play(_wav: &[u8], _keep_going: impl Fn() -> bool, _poll: Duration) -> Result<(), String> {
        Err("Read Aloud plays on macOS only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_selection_is_read_from_accessibility_without_copying() {
        let read = decide(SelectionRead::Text("Hello there".into()), || panic!("must not copy"));
        assert_eq!(read, Ok("Hello there".into()));
    }

    #[test]
    fn nothing_selected_says_to_select_text_first() {
        assert_eq!(decide(SelectionRead::Empty, || panic!("must not copy")), Err(NO_SELECTION_MESSAGE));
        assert_eq!(
            decide(SelectionRead::Text("  \n".into()), || panic!("must not copy")),
            Err(NO_SELECTION_MESSAGE)
        );
        assert_eq!(decide(SelectionRead::Unreadable, || Ok(None)), Err(NO_SELECTION_MESSAGE));
        assert_eq!(
            decide(SelectionRead::Unreadable, || Err("no clipboard".into())),
            Err(NO_SELECTION_MESSAGE)
        );
    }

    #[test]
    fn where_accessibility_cant_tell_the_selection_is_copied() {
        assert_eq!(
            decide(SelectionRead::Unreadable, || Ok(Some("From the terminal".into()))),
            Ok("From the terminal".into())
        );
    }

    #[test]
    fn a_password_field_is_never_read() {
        assert_eq!(
            decide(SelectionRead::NotEditable, || panic!("must not copy")),
            Err(NOT_READABLE_MESSAGE)
        );
    }

    #[test]
    fn only_the_current_reading_may_act() {
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(is_current(generation));
        GENERATION.fetch_add(1, Ordering::SeqCst);
        assert!(!is_current(generation));
    }

    #[test]
    fn playback_stops_as_soon_as_its_reading_is_stopped() {
        // One second of silence: playing it out would take a second.
        let mut wav = Vec::new();
        {
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate: 24_000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut writer = hound::WavWriter::new(std::io::Cursor::new(&mut wav), spec).unwrap();
            for _ in 0..24_000 {
                writer.write_sample(0i16).unwrap();
            }
            writer.finalize().unwrap();
        }
        let started = Instant::now();
        let result = platform::play(&wav, || false, Duration::from_millis(10));
        assert!(result.is_ok() || cfg!(not(target_os = "macos")));
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}

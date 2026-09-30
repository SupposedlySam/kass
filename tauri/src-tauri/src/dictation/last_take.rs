//! Kass's last take, while it is still in the field, for a voice edit
//! (docs/plans/VOICE_EDITS.md): "fix that, Morgan not Megan".
//!
//! A take is remembered only where Accessibility wrote it and it read back
//! (the live path, or the insertion chain's Accessibility step), so an edit
//! can be verified the same way. The next take that pastes anything replaces
//! it; an edit updates it. Whether it is still intact (the user hasn't typed,
//! moved the caret, or left the field) is checked when an edit is applied.

use std::sync::Mutex;

use crate::text_insert::{EditError, Owned};

/// Most of the take the server sees, in chars: the end, where an edit is
/// nearest the caret. Within the server's `LAST_TAKE_CHARS`.
pub const SENT_CHARS: usize = 1000;

pub const NOTHING_TO_FIX: &str = "Nothing to fix: Kass can only fix what it just typed";
const CHANGED: &str = "The text changed since Kass typed it, so nothing was fixed";
const NOT_APPLIED: &str = "This app didn't take the fix, so nothing changed";
const UNSUPPORTED: &str = "Voice edits don't work in this app yet";

#[derive(Debug, Clone, PartialEq)]
pub struct LastTake {
    /// The app it went to.
    pub pid: i32,
    /// The capture that wrote it.
    pub capture_id: Option<String>,
    pub owned: Owned,
}

impl LastTake {
    /// The end of the take the server may change: its last [`SENT_CHARS`]
    /// chars, from the start of a word.
    pub fn tail(&self) -> &str {
        let text = self.owned.text.as_str();
        let count = text.chars().count();
        if count <= SENT_CHARS {
            return text;
        }
        let cut = text
            .char_indices()
            .nth(count - SENT_CHARS)
            .map_or(0, |(i, _)| i);
        match text[cut..].find(char::is_whitespace) {
            Some(space) => text[cut + space..].trim_start(),
            None => "",
        }
    }
}

static LAST: Mutex<Option<LastTake>> = Mutex::new(None);

pub fn current() -> Option<LastTake> {
    LAST.lock().ok()?.clone()
}

pub fn remember(take: LastTake) {
    if let Ok(mut last) = LAST.lock() {
        *last = Some(take);
    }
}

pub fn forget() {
    if let Ok(mut last) = LAST.lock() {
        *last = None;
    }
}

/// After an edit of `edited`: the take now reads as `result` says, or it
/// can no longer be edited. Only while no other take has replaced it.
pub fn edited(edited: &LastTake, result: &Result<Owned, EditError>) {
    let Ok(mut last) = LAST.lock() else {
        return;
    };
    if last.as_ref() != Some(edited) {
        return;
    }
    *last = match result {
        Ok(owned) => Some(LastTake {
            owned: owned.clone(),
            ..edited.clone()
        }),
        // Not applied: the field is as it was, and a retry may work.
        Err(EditError::NotApplied) => Some(edited.clone()),
        Err(_) => None,
    };
}

/// What the pill says when an edit changed nothing.
pub fn message(error: &EditError) -> String {
    match error {
        EditError::Changed => CHANGED.into(),
        EditError::NotApplied => NOT_APPLIED.into(),
        EditError::Unsupported => UNSUPPORTED.into(),
        EditError::Uncertain(message) => message.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take(text: &str) -> LastTake {
        LastTake {
            pid: 7,
            capture_id: Some("c1".into()),
            owned: Owned {
                start: 0,
                text: text.into(),
                join: Default::default(),
            },
        }
    }

    #[test]
    fn a_short_take_is_sent_whole() {
        assert_eq!(take("Hi Megan.").tail(), "Hi Megan.");
    }

    #[test]
    fn a_long_take_is_sent_from_a_word_near_its_end() {
        let text = format!("{} Hi Megan.", "word ".repeat(400));
        let long = take(&text);
        let tail = long.tail();
        assert!(tail.chars().count() <= SENT_CHARS);
        assert!(tail.ends_with("Hi Megan."));
        assert!(tail.starts_with("word "));
        assert!(text.ends_with(tail));
    }
}

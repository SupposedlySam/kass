//! What a voice edit (docs/plans/VOICE_EDITS.md) may change: the text
//! before the caret when the take starts, whoever wrote it ("fix that,
//! Morgan not Megan"), and Kass's own last take, which says how much of
//! that text Kass wrote, so only a fix there is learned from.
//!
//! A take is remembered only where Accessibility wrote it and it read back
//! (the live path, or the insertion chain's Accessibility step). The next
//! take that pastes anything replaces it; an edit updates it. Whether the
//! text is still as it was read (the user hasn't typed, moved the caret, or
//! left the field) is checked when an edit is applied.

use std::sync::Mutex;

use crate::text_insert::{utf16_len, EditError, Owned};

pub const NOTHING_TO_FIX: &str = "Nothing to fix: Kass can't read the text before the cursor here";
const CHANGED: &str = "The text changed while you spoke, so nothing was fixed";
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

/// The text before the caret in `pid`'s field when a take started.
#[derive(Debug, Clone, PartialEq)]
pub struct Editable {
    pub pid: i32,
    pub owned: Owned,
    /// Kass's last take, where the text still ends with it as Kass left it.
    pub last: Option<LastTake>,
}

impl Editable {
    pub fn new(pid: i32, owned: Owned, last: Option<LastTake>) -> Self {
        let last = last.filter(|last| {
            last.pid == pid
                && last.owned.end() == owned.end()
                && (owned.text.ends_with(&last.owned.text)
                    || last.owned.text.ends_with(&owned.text))
        });
        Self { pid, owned, last }
    }

    /// How many of the text's last chars Kass's last take wrote.
    pub fn own_chars(&self) -> usize {
        self.last.as_ref().map_or(0, |last| {
            last.owned
                .text
                .chars()
                .count()
                .min(self.owned.text.chars().count())
        })
    }

    pub fn capture_id(&self) -> Option<String> {
        self.last.as_ref().and_then(|last| last.capture_id.clone())
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

/// After an edit of `edited`: Kass's last take, where it ended the text,
/// now reads as `result` left it. Only while no other take has replaced it.
pub fn edited(edited: &Editable, result: &Result<Owned, EditError>) {
    let Some(take) = &edited.last else {
        return;
    };
    let Ok(mut last) = LAST.lock() else {
        return;
    };
    if last.as_ref() != Some(take) {
        return;
    }
    *last = match result {
        Ok(owned) => Some(LastTake {
            owned: after_edit(&edited.owned, &take.owned, owned),
            ..take.clone()
        }),
        // Not applied: the field is as it was, and a retry may work.
        Err(EditError::NotApplied) => Some(take.clone()),
        Err(_) => None,
    };
}

/// Kass's part `own` of the text `before`, once the edit made it `after`:
/// the same words, moved, when the edit was before them; else the text from
/// where they started.
fn after_edit(before: &Owned, own: &Owned, after: &Owned) -> Owned {
    let text = if after.text.ends_with(&own.text) {
        own.text.clone()
    } else {
        let from = (own.start - before.start).max(0);
        from_unit(&after.text, from).to_string()
    };
    Owned {
        start: after.end() - utf16_len(&text),
        text,
        join: own.join.clone(),
    }
}

/// `text` from its UTF-16 unit `unit` on.
fn from_unit(text: &str, unit: i64) -> &str {
    let mut units = 0;
    for (at, c) in text.char_indices() {
        if units >= unit {
            return &text[at..];
        }
        units += c.len_utf16() as i64;
    }
    ""
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

    fn owned(start: i64, text: &str) -> Owned {
        Owned {
            start,
            text: text.into(),
            join: Default::default(),
        }
    }

    fn take(start: i64, text: &str) -> LastTake {
        LastTake {
            pid: 7,
            capture_id: Some("c1".into()),
            owned: owned(start, text),
        }
    }

    #[test]
    fn kass_wrote_the_end_of_the_text_while_its_last_take_ends_it() {
        let text = owned(0, "I typed this. Hi Megan.");
        let editable = Editable::new(7, text.clone(), Some(take(14, "Hi Megan.")));
        assert_eq!(editable.own_chars(), 9);
        assert_eq!(editable.capture_id().as_deref(), Some("c1"));
    }

    #[test]
    fn text_kass_did_not_just_write_is_still_editable_but_not_its_own() {
        let text = owned(0, "I typed this. Hi Megan. More");
        // The user typed after the take, or it went to another app.
        for last in [
            take(14, "Hi Megan."),
            LastTake {
                pid: 8,
                ..take(23, " More")
            },
        ] {
            let editable = Editable::new(7, text.clone(), Some(last));
            assert_eq!(editable.own_chars(), 0);
            assert_eq!(editable.capture_id(), None);
        }
        assert_eq!(Editable::new(7, text, None).own_chars(), 0);
    }

    #[test]
    fn a_take_longer_than_the_text_read_owns_all_of_it() {
        let text = owned(10, "Hi Megan.");
        let editable = Editable::new(7, text, Some(take(0, "0123456789Hi Megan.")));
        assert_eq!(editable.own_chars(), 9);
    }

    #[test]
    fn a_fix_in_kass_s_part_keeps_it_kass_s() {
        let before = owned(0, "I typed this. Hi Megan.");
        let own = owned(14, "Hi Megan.");
        let after = owned(0, "I typed this. Hi Morgan.");
        assert_eq!(after_edit(&before, &own, &after), owned(14, "Hi Morgan."));
    }

    #[test]
    fn a_fix_before_kass_s_part_moves_it() {
        let before = owned(0, "I typed thsi. Hi Megan.");
        let own = owned(14, "Hi Megan.");
        let after = owned(0, "I typed this one. Hi Megan.");
        assert_eq!(after_edit(&before, &own, &after), owned(18, "Hi Megan."));
    }

    #[test]
    fn a_fix_remembers_the_take_as_it_now_reads() {
        forget();
        let last = take(14, "Hi Megan.");
        remember(last.clone());
        let editable = Editable::new(7, owned(0, "I typed this. Hi Megan."), Some(last));
        edited(&editable, &Ok(owned(0, "I typed this. Hi Morgan.")));
        assert_eq!(current().map(|l| l.owned), Some(owned(14, "Hi Morgan.")));
        forget();
    }
}

//! `voicebox://` links: open a screen in the main window from outside the
//! app, e.g. `voicebox://captures?capture=<id>` from a review doc.
//!
//! macOS delivers the link as `RunEvent::Opened` (the scheme is registered by
//! `CFBundleURLTypes` in Info.plist, so only an installed build receives
//! them). A link can arrive before the main window has loaded, when it is
//! what launched the app, so the latest one is also kept until the frontend
//! takes it.

use std::sync::Mutex;

use tauri::{command, AppHandle, Emitter, Manager, State};

pub const SCHEME: &str = "voicebox";
const EVENT: &str = "deep-link";
const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Default)]
pub struct DeepLinkState {
    pending: Mutex<Option<String>>,
}

/// The in-app route for a `voicebox://` link: `voicebox://captures?capture=x`
/// is `/captures?capture=x`. None for other schemes.
pub fn route(url: &str) -> Option<String> {
    let rest = url.strip_prefix(SCHEME)?.strip_prefix("://")?;
    Some(format!("/{}", rest.trim_start_matches('/')))
}

/// Show the main window and send it the link's route.
pub fn open(app: &AppHandle, url: &str) {
    let Some(route) = route(url) else { return };
    *app.state::<DeepLinkState>().pending.lock().unwrap() = Some(route.clone());
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to(MAIN_WINDOW_LABEL, EVENT, route) {
        eprintln!("Failed to send deep link to the main window: {error}");
    }
}

/// The route of a link that arrived before the frontend listened, once.
#[command]
pub fn take_deep_link(state: State<'_, DeepLinkState>) -> Option<String> {
    state.pending.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::route;

    #[test]
    fn maps_a_link_to_its_route() {
        assert_eq!(
            route("voicebox://captures?capture=abc").as_deref(),
            Some("/captures?capture=abc")
        );
        assert_eq!(route("voicebox:///settings/dictation").as_deref(), Some("/settings/dictation"));
        assert_eq!(route("voicebox://").as_deref(), Some("/"));
        assert_eq!(route("https://example.com"), None);
        assert_eq!(route("voiceboxx://captures"), None);
    }
}

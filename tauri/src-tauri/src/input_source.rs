//! Whether Voicebox Input (the input method in `tauri/input-method`) is
//! installed, enabled and selected, and a one-click way to turn it on.
//!
//! The input method can only insert text while it is the selected input
//! source, so the status bar shows its state and [`activate`] registers,
//! enables and selects it without a trip through System Settings.
//!
//! Text Input Sources calls belong on the main thread; Tauri runs the sync
//! commands that call these there.

use serde::Serialize;

/// `TISInputSourceID` in the input method's Info.plist.
pub const SOURCE_ID: &str = "sh.voicebox.inputmethod.VoiceboxInput";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InputSourceState {
    /// Not in `~/Library/Input Methods`; `scripts/install.sh` puts it there.
    NotInstalled,
    /// Installed but not in the user's input sources.
    Disabled,
    /// In the input sources, but another keyboard is selected.
    Enabled,
    /// The selected keyboard, so it can insert text.
    Selected,
}

/// Where `scripts/install.sh` installs the bundle.
fn bundle_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(std::path::Path::new(&home).join("Library/Input Methods/Voicebox Input.app"))
}

pub fn state() -> InputSourceState {
    let installed = bundle_path().is_some_and(|p| p.exists());
    match macos::find() {
        Some(source) if source.selected => InputSourceState::Selected,
        Some(source) if source.enabled => InputSourceState::Enabled,
        Some(_) => InputSourceState::Disabled,
        None if installed => InputSourceState::Disabled,
        None => InputSourceState::NotInstalled,
    }
}

/// Register, enable and select Voicebox Input, returning the state it ends
/// in. Registering picks up a fresh install without a logout.
pub fn activate() -> Result<InputSourceState, String> {
    if macos::find().is_none() {
        let path = bundle_path()
            .filter(|p| p.exists())
            .ok_or("Voicebox Input is not installed. Run scripts/install.sh.")?;
        macos::register(&path)?;
    }
    macos::enable_and_select()?;
    Ok(state())
}

mod macos {
    use super::SOURCE_ID;
    use core_foundation_sys::array::{CFArrayGetCount, CFArrayGetValueAtIndex, CFArrayRef};
    use core_foundation_sys::base::{CFRelease, CFTypeRef};
    use core_foundation_sys::dictionary::{
        kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionaryCreate,
        CFDictionaryRef,
    };
    use core_foundation_sys::number::{CFBooleanGetValue, CFBooleanRef};
    use core_foundation_sys::string::{
        kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringRef,
    };
    use core_foundation_sys::url::{CFURLCreateFromFileSystemRepresentation, CFURLRef};
    use std::ffi::c_void;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    type TISInputSourceRef = *mut c_void;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn TISCreateInputSourceList(
            properties: CFDictionaryRef,
            include_all_installed: u8,
        ) -> CFArrayRef;
        fn TISGetInputSourceProperty(source: TISInputSourceRef, key: CFStringRef) -> *mut c_void;
        fn TISRegisterInputSource(location: CFURLRef) -> i32;
        fn TISEnableInputSource(source: TISInputSourceRef) -> i32;
        fn TISSelectInputSource(source: TISInputSourceRef) -> i32;

        static kTISPropertyInputSourceID: CFStringRef;
        static kTISPropertyInputSourceIsEnabled: CFStringRef;
        static kTISPropertyInputSourceIsSelected: CFStringRef;
    }

    pub struct Found {
        pub enabled: bool,
        pub selected: bool,
    }

    pub fn find() -> Option<Found> {
        with_source(|source| Found {
            enabled: flag(source, unsafe { kTISPropertyInputSourceIsEnabled }),
            selected: flag(source, unsafe { kTISPropertyInputSourceIsSelected }),
        })
    }

    pub fn register(bundle: &Path) -> Result<(), String> {
        let bytes = bundle.as_os_str().as_bytes();
        unsafe {
            let url = CFURLCreateFromFileSystemRepresentation(
                std::ptr::null(),
                bytes.as_ptr(),
                bytes.len() as isize,
                1,
            );
            if url.is_null() {
                return Err("Could not locate Voicebox Input.".into());
            }
            let status = TISRegisterInputSource(url);
            CFRelease(url as CFTypeRef);
            check(status, "register")
        }
    }

    pub fn enable_and_select() -> Result<(), String> {
        with_source(|source| unsafe {
            check(TISEnableInputSource(source), "enable")?;
            check(TISSelectInputSource(source), "select")
        })
        .unwrap_or_else(|| {
            Err("macOS has not picked up Voicebox Input yet. Log out and back in.".into())
        })
    }

    fn check(status: i32, action: &str) -> Result<(), String> {
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "Could not {action} Voicebox Input (error {status})."
            ))
        }
    }

    fn flag(source: TISInputSourceRef, key: CFStringRef) -> bool {
        unsafe {
            let value = TISGetInputSourceProperty(source, key);
            !value.is_null() && CFBooleanGetValue(value as CFBooleanRef)
        }
    }

    /// Run `f` on the installed Voicebox Input source, if macOS knows it.
    fn with_source<T>(f: impl FnOnce(TISInputSourceRef) -> T) -> Option<T> {
        unsafe {
            let id = CFStringCreateWithBytes(
                std::ptr::null(),
                SOURCE_ID.as_ptr(),
                SOURCE_ID.len() as isize,
                kCFStringEncodingUTF8,
                0,
            );
            if id.is_null() {
                return None;
            }
            let keys = [kTISPropertyInputSourceID as *const c_void];
            let values = [id as *const c_void];
            let filter = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            CFRelease(id as CFTypeRef);
            if filter.is_null() {
                return None;
            }
            let list = TISCreateInputSourceList(filter, 1);
            CFRelease(filter as CFTypeRef);
            if list.is_null() {
                return None;
            }
            let result = (CFArrayGetCount(list) > 0)
                .then(|| f(CFArrayGetValueAtIndex(list, 0) as TISInputSourceRef));
            CFRelease(list as CFTypeRef);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    /// Reads this Mac's real input sources, so it only runs on request:
    /// `cargo test input_source -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reports_the_installed_state() {
        println!("Voicebox Input: {:?}", super::state());
    }
}

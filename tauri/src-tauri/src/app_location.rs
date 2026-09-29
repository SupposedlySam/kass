//! Where the app runs from, and moving it into `/Applications`.
//!
//! macOS ties privacy grants (Microphone, Accessibility, Input Monitoring)
//! to the app it recorded them for. Run from somewhere else — the build
//! folder, Downloads, a disk image — Voicebox can be missing from the
//! Privacy panes, or its switches are on but don't work. So the app asks to
//! be moved when it isn't in `/Applications`, and can move itself.
//!
//! A dev build runs a bare binary from `target/`, not a bundle, and is left
//! alone.

use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use objc::runtime::{Object, BOOL, YES};
use objc::{class, msg_send, sel, sel_impl};
use serde::Serialize;

use crate::focus_capture::{ns_string_to_rust, AutoreleasePool};

type Id = *mut Object;

pub const APPLICATIONS: &str = "/Applications";
pub const INSTALLED_APP: &str = "/Applications/Voicebox.app";

/// The `.app` bundle whose `Contents/MacOS/` holds `exe`, if any.
fn bundle_of(exe: &Path) -> Option<&Path> {
    let in_contents_macos = exe.parent().and_then(Path::file_name) == Some("MacOS".as_ref())
        && exe.ancestors().nth(2).and_then(Path::file_name) == Some("Contents".as_ref());
    let bundle = exe.ancestors().nth(3)?;
    (in_contents_macos && bundle.extension() == Some("app".as_ref())).then_some(bundle)
}

/// Whether `exe` is the binary of a bundle directly in `/Applications`.
pub fn is_installed_executable(exe: &Path) -> bool {
    bundle_of(exe).and_then(Path::parent) == Some(Path::new(APPLICATIONS))
}

/// The bundle this process runs from, or None for a dev build.
fn running_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    bundle_of(&exe).map(Path::to_path_buf)
}

pub fn is_installed() -> bool {
    std::env::current_exe().is_ok_and(|exe| is_installed_executable(&exe))
}

#[derive(Debug, Clone, Serialize)]
pub struct AppLocation {
    /// A bundle outside `/Applications`. False for a dev build.
    pub needs_move: bool,
    /// Where the running bundle is.
    pub path: Option<String>,
    /// Moving would put an existing `/Applications/Voicebox.app` in the Trash.
    pub replaces_existing: bool,
}

pub fn location() -> AppLocation {
    let bundle = running_bundle();
    let needs_move = bundle.is_some() && !is_installed();
    AppLocation {
        needs_move,
        path: bundle.map(|b| b.display().to_string()),
        replaces_existing: needs_move && Path::new(INSTALLED_APP).exists(),
    }
}

/// Copy the running bundle to `/Applications/Voicebox.app`, putting any app
/// already there in the Trash, then put the old copy in the Trash too.
/// Returns the new bundle's path; the caller relaunches from it.
pub fn copy_into_applications() -> Result<PathBuf, String> {
    let source = running_bundle().ok_or("Voicebox isn't running from an app bundle")?;
    let dest = PathBuf::from(INSTALLED_APP);
    if source == dest {
        return Err("Voicebox is already in Applications".into());
    }
    if dest.exists() {
        trash(&dest).map_err(|e| format!("Couldn't move the Voicebox in Applications to the Trash: {e}"))?;
    }
    // ditto keeps the code signature and extended attributes intact.
    let status = Command::new("/usr/bin/ditto")
        .arg(&source)
        .arg(&dest)
        .status()
        .map_err(|e| format!("Couldn't copy Voicebox into Applications: {e}"))?;
    if !status.success() {
        return Err(format!("Couldn't copy Voicebox into Applications (ditto {status})"));
    }
    // A copy on a disk image or in a read-only location stays where it is.
    if let Err(e) = trash(&source) {
        eprintln!("[app-location] left the old copy at {}: {e}", source.display());
    }
    Ok(dest)
}

/// Open `bundle` once this process (`pid`) has exited. Opening it sooner
/// would just bring the running copy forward, since both share a bundle id.
pub fn relaunch_after_exit(pid: u32, bundle: &Path) -> Result<(), String> {
    Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open "$2""#)
        .arg("sh")
        .arg(pid.to_string())
        .arg(bundle)
        .spawn()
        .map_err(|e| format!("Couldn't schedule the relaunch: {e}"))?;
    Ok(())
}

/// Move `path` to the Trash, so nothing is deleted outright.
fn trash(path: &Path) -> Result<(), String> {
    let c_path = CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    unsafe {
        let _pool = AutoreleasePool::new();
        let ns_path: Id = msg_send![class!(NSString), stringWithUTF8String: c_path.as_ptr()];
        let url: Id = msg_send![class!(NSURL), fileURLWithPath: ns_path];
        let manager: Id = msg_send![class!(NSFileManager), defaultManager];
        let mut error: Id = std::ptr::null_mut();
        let ok: BOOL = msg_send![manager, trashItemAtURL: url
                                          resultingItemURL: std::ptr::null_mut::<Id>()
                                          error: &mut error];
        if ok == YES {
            return Ok(());
        }
        if error.is_null() {
            return Err("unknown error".into());
        }
        let description: Id = msg_send![error, localizedDescription];
        Err(ns_string_to_rust(description).unwrap_or_else(|| "unknown error".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_bundle_in_applications_counts() {
        let installed = |p: &str| is_installed_executable(Path::new(p));
        assert!(installed("/Applications/Voicebox.app/Contents/MacOS/voicebox"));
        assert!(!installed("/Users/me/Applications/Voicebox.app/Contents/MacOS/voicebox"));
        assert!(!installed("/Users/me/Downloads/Voicebox.app/Contents/MacOS/voicebox"));
        assert!(!installed(
            "/Users/me/voicebox/tauri/src-tauri/target/release/bundle/macos/Voicebox.app/Contents/MacOS/voicebox"
        ));
        assert!(!installed("/Users/me/voicebox/tauri/src-tauri/target/debug/voicebox"));
        assert!(!installed("/Applications/Voicebox.app/Contents/Resources/voicebox"));
        assert!(!installed("/Applications/Voicebox/Contents/MacOS/voicebox"));
        assert!(!installed("/voicebox"));
    }

    #[test]
    fn a_dev_binary_has_no_bundle() {
        assert_eq!(
            bundle_of(Path::new("/Users/me/voicebox/tauri/src-tauri/target/debug/voicebox")),
            None
        );
        assert_eq!(
            bundle_of(Path::new("/Users/me/Downloads/Voicebox.app/Contents/MacOS/voicebox")),
            Some(Path::new("/Users/me/Downloads/Voicebox.app"))
        );
    }
}

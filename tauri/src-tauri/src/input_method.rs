//! Insertion through the Voicebox input method ("Voicebox Input").
//!
//! Voicebox Input (`tauri/input-method`) is an InputMethodKit input source
//! the user keeps selected as their keyboard. It passes every key through,
//! and it listens on a Unix socket for text to insert into the field it is
//! attached to, with IMK's `insertText` — no clipboard, no synthetic keys.
//!
//! The protocol is one newline-terminated JSON object each way per
//! connection:
//!
//! ```text
//! → {"v":1,"bundle_id":"com.tinyspeck.slackmacgap","text":"..."}
//! ← {"result":"inserted","verified":true}
//! ← {"result":"declined","reason":"..."}
//! ← {"result":"uncertain","reason":"..."}
//! ```
//!
//! The input method declines when no field is active, when the active field
//! belongs to a different app than the one we dictated into, and for
//! terminals. The rule this client keeps for the chain: anything that fails
//! before the whole request line is written is [`Attempt::Declined`] (the
//! input method acts only on a complete line); anything that fails after it
//! is [`Attempt::Uncertain`], since the text may have gone in.

// Until the paste flow in main.rs builds its chain with this step.

use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::insert_chain::{Attempt, Inserter, Method, Request};

pub const PROTOCOL_VERSION: u32 = 1;

/// The socket file name, in the app's Application Support directory.
pub const SOCKET_NAME: &str = "input-method.sock";

/// Longest reply accepted. Real replies are well under 1 KiB.
pub const MAX_REPLY_BYTES: usize = 64 * 1024;

/// How long to wait for the request to be written. Local and tiny, so this
/// only matters if the input method is wedged.
pub const WRITE_TIMEOUT: Duration = Duration::from_millis(100);

/// How long to wait for the reply once the request is written. The input
/// method declines requests older than 250 ms when its main thread gets to
/// them, so a reply later than this is rare and the insert likely happened
/// or never will.
pub const REPLY_TIMEOUT: Duration = Duration::from_millis(400);

/// `~/Library/Application Support/sh.voicebox.app/input-method.sock`, the
/// path the input method listens on (`defaultSocketPath` in
/// `tauri/input-method/Sources/SocketServer.swift`).
pub fn default_socket_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support/sh.voicebox.app")
            .join(SOCKET_NAME),
    )
}

#[derive(Serialize)]
struct WireRequest<'a> {
    v: u32,
    bundle_id: &'a str,
    text: &'a str,
}

/// The request line, newline included.
pub fn encode_request(bundle_id: &str, text: &str) -> Vec<u8> {
    let mut line = serde_json::to_vec(&WireRequest {
        v: PROTOCOL_VERSION,
        bundle_id,
        text,
    })
    .expect("a struct of strings always serializes");
    line.push(b'\n');
    line
}

/// What the input method answered.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "result", rename_all = "lowercase")]
pub enum Reply {
    Inserted { verified: bool },
    Declined { reason: String },
    Uncertain { reason: String },
}

/// Parse one reply line (with or without its newline).
pub fn decode_reply(line: &[u8]) -> Result<Reply, String> {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    serde_json::from_slice(line).map_err(|e| format!("malformed reply: {e}"))
}

impl From<Reply> for Attempt {
    fn from(reply: Reply) -> Self {
        match reply {
            Reply::Inserted { verified } => Attempt::Inserted { verified },
            Reply::Declined { reason } => Attempt::Declined(reason),
            Reply::Uncertain { reason } => Attempt::Uncertain(reason),
        }
    }
}

/// The input method step of the insert chain.
#[derive(Debug, Clone)]
pub struct InputMethod {
    socket: Option<PathBuf>,
    write_timeout: Duration,
    reply_timeout: Duration,
}

impl InputMethod {
    /// Talks to the input method at [`default_socket_path`].
    pub fn new() -> Self {
        Self {
            socket: default_socket_path(),
            write_timeout: WRITE_TIMEOUT,
            reply_timeout: REPLY_TIMEOUT,
        }
    }

    /// Talks to the input method at `socket`.
    #[cfg(test)]
    pub fn with_socket(socket: impl Into<PathBuf>) -> Self {
        Self {
            socket: Some(socket.into()),
            ..Self::new()
        }
    }

    #[cfg(test)]
    pub fn with_timeouts(mut self, write: Duration, reply: Duration) -> Self {
        self.write_timeout = write;
        self.reply_timeout = reply;
        self
    }

    fn exchange(&self, socket: &Path, bundle_id: &str, text: &str) -> Attempt {
        // A missing socket or no listener fails here at once: nothing sent.
        let mut stream = match UnixStream::connect(socket) {
            Ok(stream) => stream,
            Err(e) => return Attempt::Declined(format!("input method not running ({e})")),
        };
        // Both timeouts are set before sending: once the input method has
        // replied and closed, macOS refuses socket options (EINVAL).
        if let Err(e) = stream
            .set_write_timeout(Some(self.write_timeout))
            .and_then(|()| stream.set_read_timeout(Some(self.reply_timeout)))
        {
            return Attempt::Declined(format!("socket error ({e})"));
        }
        // The input method acts only on a complete line, so a failed write
        // (even a partial one: the newline goes last) inserted nothing.
        let line = encode_request(bundle_id, text);
        if let Err(e) = stream.write_all(&line) {
            return Attempt::Declined(format!("couldn't send to the input method ({e})"));
        }
        match read_reply(&mut stream, self.reply_timeout) {
            Ok(reply) => reply.into(),
            Err(why) => Attempt::Uncertain(format!("input method: {why}")),
        }
    }
}

impl Default for InputMethod {
    fn default() -> Self {
        Self::new()
    }
}

impl Inserter for InputMethod {
    fn method(&self) -> Method {
        Method::InputMethod
    }

    fn attempt(&self, req: &Request) -> Attempt {
        if req.text.is_empty() {
            return Attempt::Declined("empty text".into());
        }
        let Some(bundle_id) = req.bundle_id.filter(|id| !id.is_empty()) else {
            return Attempt::Declined("target app unknown".into());
        };
        let Some(socket) = &self.socket else {
            return Attempt::Declined("no home directory for the socket".into());
        };
        self.exchange(socket, bundle_id, req.text)
    }
}

/// Read one reply line within `timeout` overall. The stream's read timeout
/// must already be set to at most `timeout`.
fn read_reply(stream: &mut UnixStream, timeout: Duration) -> Result<Reply, String> {
    let deadline = Instant::now() + timeout;
    let mut buf = Vec::with_capacity(128);
    let mut chunk = [0u8; 1024];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!("no reply within {} ms", timeout.as_millis()));
        }
        // Shrink the per-read timeout to what is left. This fails with
        // EINVAL once the peer has closed; then the read returns at once
        // anyway, and the timeout set before sending still bounds it.
        let _ = stream.set_read_timeout(Some(remaining));
        match stream.read(&mut chunk) {
            Ok(0) => {
                return Err(if buf.is_empty() {
                    "closed without a reply".into()
                } else {
                    "closed mid-reply".into()
                })
            }
            Ok(n) => {
                let end = chunk[..n].iter().position(|&b| b == b'\n');
                buf.extend_from_slice(&chunk[..end.unwrap_or(n)]);
                if buf.len() > MAX_REPLY_BYTES {
                    return Err("reply too large".into());
                }
                if end.is_some() {
                    return decode_reply(&buf);
                }
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return Err(format!("no reply within {} ms", timeout.as_millis()))
            }
            Err(e) => return Err(format!("read failed ({e})")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::thread;

    // ─── Protocol ─────────────────────────────────────────────────────

    fn roundtrip_request(text: &str) {
        let line = encode_request("com.tinyspeck.slackmacgap", text);
        assert_eq!(line.last(), Some(&b'\n'));
        assert_eq!(
            line.iter().filter(|&&b| b == b'\n').count(),
            1,
            "only the terminator is a raw newline: {text:?}"
        );
        let value: serde_json::Value = serde_json::from_slice(&line[..line.len() - 1]).unwrap();
        assert_eq!(value["v"], 1);
        assert_eq!(value["bundle_id"], "com.tinyspeck.slackmacgap");
        assert_eq!(value["text"], text);
    }

    #[test]
    fn request_encoding_round_trips_any_text() {
        for text in [
            "hello",
            "héllo wörld",
            "emoji 👩‍💻🎉 and flags 🇺🇸",
            "line\nbreak\r\nand\ttab",
            r#"quotes " and 'single' and \backslash\"#,
            "\u{0}\u{1f}\u{7f}\u{2028}\u{2029}",
            "日本語のテキスト",
            &"long ".repeat(20_000),
        ] {
            roundtrip_request(text);
        }
    }

    #[test]
    fn request_has_the_exact_wire_shape() {
        assert_eq!(
            encode_request("a.b", "x\"y\n"),
            b"{\"v\":1,\"bundle_id\":\"a.b\",\"text\":\"x\\\"y\\n\"}\n".to_vec()
        );
    }

    #[test]
    fn decodes_every_reply_variant() {
        assert_eq!(
            decode_reply(br#"{"result":"inserted","verified":true}"#),
            Ok(Reply::Inserted { verified: true })
        );
        assert_eq!(
            decode_reply(b"{\"result\":\"inserted\",\"verified\":false}\n"),
            Ok(Reply::Inserted { verified: false })
        );
        assert_eq!(
            decode_reply(br#"{"reason":"no active text field","result":"declined"}"#),
            Ok(Reply::Declined {
                reason: "no active text field".into()
            })
        );
        assert_eq!(
            decode_reply(r#"{"result":"uncertain","reason":"é 🎉 \"q\"\n"}"#.as_bytes()),
            Ok(Reply::Uncertain {
                reason: "é 🎉 \"q\"\n".into()
            })
        );
        // Extra fields from a newer input method are ignored.
        assert_eq!(
            decode_reply(br#"{"result":"inserted","verified":true,"ms":1.2}"#),
            Ok(Reply::Inserted { verified: true })
        );
    }

    #[test]
    fn rejects_malformed_replies() {
        for bad in [
            &br#"{"result":"exploded"}"#[..],
            br#"{"result":"inserted"}"#,
            br#"{"result":"inserted","verified":"yes"}"#,
            br#"{"result":"declined"}"#,
            br#"{"verified":true}"#,
            br#"{"result":"inserted","verified":tr"#,
            b"garbage",
            b"",
            b"\n",
            b"[]",
            b"null",
        ] {
            assert!(
                decode_reply(bad).is_err(),
                "{:?} should not decode",
                String::from_utf8_lossy(bad)
            );
        }
    }

    #[test]
    fn replies_map_onto_attempts() {
        assert_eq!(
            Attempt::from(Reply::Inserted { verified: true }),
            Attempt::Inserted { verified: true }
        );
        assert_eq!(
            Attempt::from(Reply::Declined { reason: "x".into() }),
            Attempt::Declined("x".into())
        );
        assert_eq!(
            Attempt::from(Reply::Uncertain { reason: "y".into() }),
            Attempt::Uncertain("y".into())
        );
    }

    #[test]
    fn default_socket_path_is_in_application_support() {
        let path = default_socket_path().unwrap();
        assert!(path.ends_with("Library/Application Support/sh.voicebox.app/input-method.sock"));
        // sockaddr_un.sun_path is 104 bytes on macOS.
        assert!(path.as_os_str().len() < 104, "{path:?}");
    }

    // ─── Client against a fake input method ──────────────────────────

    /// A temp dir with a short path (sun_path is 104 bytes), removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static N: AtomicUsize = AtomicUsize::new(0);
            let dir = PathBuf::from("/tmp").join(format!(
                "vbim-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn socket(&self) -> PathBuf {
            self.0.join("im.sock")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// What the fake server does with a connection.
    #[derive(Clone)]
    enum Behavior {
        /// Read the request, then write these bytes.
        Reply(Vec<u8>),
        /// Read the request, then hold the connection open without replying.
        Silent(Duration),
        /// Read the request, then close.
        Close,
    }

    /// Serve `n` connections, sending each request line down the channel.
    fn serve(
        dir: &TempDir,
        n: usize,
        behavior: Behavior,
    ) -> (mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let listener = UnixListener::bind(dir.socket()).unwrap();
        std::fs::set_permissions(dir.socket(), std::fs::Permissions::from_mode(0o600)).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            for _ in 0..n {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                tx.send(line).unwrap();
                let mut stream = stream;
                match &behavior {
                    Behavior::Reply(bytes) => {
                        let _ = stream.write_all(bytes);
                    }
                    Behavior::Silent(hold) => thread::sleep(*hold),
                    Behavior::Close => {}
                }
            }
        });
        (rx, handle)
    }

    fn request<'a>(text: &'a str) -> Request<'a> {
        Request {
            pid: 1,
            bundle_id: Some("com.tinyspeck.slackmacgap"),
            role: None,
            text,
        }
    }

    fn fast(socket: PathBuf) -> InputMethod {
        InputMethod::with_socket(socket)
            .with_timeouts(Duration::from_millis(100), Duration::from_millis(150))
    }

    #[test]
    fn inserted_reply_is_inserted_and_the_request_arrives_intact() {
        let dir = TempDir::new();
        let (rx, server) = serve(
            &dir,
            1,
            Behavior::Reply(b"{\"result\":\"inserted\",\"verified\":true}\n".to_vec()),
        );
        let text = "Hi \"team\",\nship it 🚀";
        let attempt = fast(dir.socket()).attempt(&request(text));
        assert_eq!(attempt, Attempt::Inserted { verified: true });
        let line = rx.recv().unwrap();
        assert_eq!(
            line.as_bytes(),
            encode_request("com.tinyspeck.slackmacgap", text)
        );
        server.join().unwrap();
    }

    #[test]
    fn unverified_insert_is_passed_through() {
        let dir = TempDir::new();
        let (_rx, server) = serve(
            &dir,
            1,
            Behavior::Reply(b"{\"result\":\"inserted\",\"verified\":false}\n".to_vec()),
        );
        assert_eq!(
            fast(dir.socket()).attempt(&request("x")),
            Attempt::Inserted { verified: false }
        );
        server.join().unwrap();
    }

    #[test]
    fn declined_reply_is_declined_with_its_reason() {
        let dir = TempDir::new();
        let (_rx, server) = serve(
            &dir,
            1,
            Behavior::Reply(
                b"{\"result\":\"declined\",\"reason\":\"no active text field\"}\n".to_vec(),
            ),
        );
        assert_eq!(
            fast(dir.socket()).attempt(&request("x")),
            Attempt::Declined("no active text field".into())
        );
        server.join().unwrap();
    }

    #[test]
    fn uncertain_reply_is_uncertain() {
        let dir = TempDir::new();
        let (_rx, server) = serve(
            &dir,
            1,
            Behavior::Reply(b"{\"result\":\"uncertain\",\"reason\":\"hm\"}\n".to_vec()),
        );
        assert_eq!(
            fast(dir.socket()).attempt(&request("x")),
            Attempt::Uncertain("hm".into())
        );
        server.join().unwrap();
    }

    /// Any reply we can't read after sending the request might follow an
    /// insert, so it must stop the chain.
    #[test]
    fn unreadable_replies_after_the_request_are_uncertain() {
        let long = {
            let mut v = vec![b'x'; MAX_REPLY_BYTES + 10];
            v.push(b'\n');
            v
        };
        for (bytes, expect) in [
            (&b"{\"result\":\"exploded\"}\n"[..], "malformed reply"),
            (b"garbage\n", "malformed reply"),
            (b"\n", "malformed reply"),
            (b"{\"result\":\"inserted\",\"veri", "closed mid-reply"),
            (&long, "reply too large"),
        ] {
            let dir = TempDir::new();
            let (_rx, server) = serve(&dir, 1, Behavior::Reply(bytes.to_vec()));
            match fast(dir.socket()).attempt(&request("x")) {
                Attempt::Uncertain(why) => assert!(why.contains(expect), "{why}"),
                other => panic!("{:?} → {other:?}", String::from_utf8_lossy(bytes)),
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn server_that_closes_before_replying_is_uncertain() {
        let dir = TempDir::new();
        let (_rx, server) = serve(&dir, 1, Behavior::Close);
        match fast(dir.socket()).attempt(&request("x")) {
            Attempt::Uncertain(why) => assert!(why.contains("closed without a reply"), "{why}"),
            other => panic!("{other:?}"),
        }
        server.join().unwrap();
    }

    #[test]
    fn server_that_never_replies_is_uncertain_within_the_timeout() {
        let dir = TempDir::new();
        let (_rx, server) = serve(&dir, 1, Behavior::Silent(Duration::from_millis(600)));
        let im = InputMethod::with_socket(dir.socket())
            .with_timeouts(Duration::from_millis(100), Duration::from_millis(120));
        let started = Instant::now();
        let attempt = im.attempt(&request("x"));
        let took = started.elapsed();
        match attempt {
            Attempt::Uncertain(why) => assert!(why.contains("no reply within 120 ms"), "{why}"),
            other => panic!("{other:?}"),
        }
        assert!(took >= Duration::from_millis(120), "{took:?}");
        assert!(took < Duration::from_millis(300), "{took:?}");
        server.join().unwrap();
    }

    #[test]
    fn default_reply_timeout_bounds_a_silent_server() {
        let dir = TempDir::new();
        let (_rx, server) = serve(&dir, 1, Behavior::Silent(Duration::from_millis(800)));
        let started = Instant::now();
        let attempt = InputMethod::with_socket(dir.socket()).attempt(&request("x"));
        let took = started.elapsed();
        assert!(matches!(attempt, Attempt::Uncertain(_)), "{attempt:?}");
        assert!(took >= REPLY_TIMEOUT && took < REPLY_TIMEOUT + Duration::from_millis(200));
        server.join().unwrap();
    }

    #[test]
    fn missing_socket_declines_at_once() {
        let dir = TempDir::new();
        let im = fast(dir.socket());
        let mut worst = Duration::ZERO;
        for _ in 0..200 {
            let started = Instant::now();
            let attempt = im.attempt(&request("x"));
            worst = worst.max(started.elapsed());
            assert!(matches!(attempt, Attempt::Declined(ref why) if why.contains("not running")));
        }
        println!(
            "missing socket: worst decline {:.3} ms",
            worst.as_secs_f64() * 1e3
        );
        assert!(worst < Duration::from_millis(3), "{worst:?}");
    }

    #[test]
    fn stale_socket_with_no_listener_declines_at_once() {
        let dir = TempDir::new();
        // Bind then drop the listener: the socket file stays, nobody listens.
        drop(UnixListener::bind(dir.socket()).unwrap());
        assert!(dir.socket().exists());
        let im = fast(dir.socket());
        let mut worst = Duration::ZERO;
        for _ in 0..200 {
            let started = Instant::now();
            let attempt = im.attempt(&request("x"));
            worst = worst.max(started.elapsed());
            assert!(
                matches!(attempt, Attempt::Declined(ref why) if why.contains("not running")),
                "{attempt:?}"
            );
        }
        println!(
            "stale socket: worst decline {:.3} ms",
            worst.as_secs_f64() * 1e3
        );
        assert!(worst < Duration::from_millis(3), "{worst:?}");
    }

    #[test]
    fn declines_without_a_bundle_id_or_text_without_connecting() {
        let dir = TempDir::new();
        // No server: a connection attempt would say "not running".
        let im = fast(dir.socket());
        for bundle_id in [None, Some("")] {
            let req = Request {
                pid: 1,
                bundle_id,
                role: None,
                text: "x",
            };
            assert_eq!(
                im.attempt(&req),
                Attempt::Declined("target app unknown".into())
            );
        }
        assert_eq!(
            im.attempt(&request("")),
            Attempt::Declined("empty text".into())
        );
    }

    #[test]
    fn reports_its_method() {
        assert_eq!(InputMethod::new().method(), Method::InputMethod);
    }

    /// The speed number: a full request/reply against a local server that
    /// answers at once.
    #[test]
    fn round_trip_latency_against_a_local_server() {
        const N: usize = 500;
        let dir = TempDir::new();
        let (_rx, server) = serve(
            &dir,
            N,
            Behavior::Reply(b"{\"result\":\"inserted\",\"verified\":true}\n".to_vec()),
        );
        let im = InputMethod::with_socket(dir.socket());
        let text = "Sounds good, I'll send the notes after lunch. 👍";
        let mut times: Vec<Duration> = (0..N)
            .map(|_| {
                let started = Instant::now();
                assert_eq!(
                    im.attempt(&request(text)),
                    Attempt::Inserted { verified: true }
                );
                started.elapsed()
            })
            .collect();
        server.join().unwrap();
        times.sort();
        let at = |p: f64| times[((N as f64 * p) as usize).min(N - 1)].as_secs_f64() * 1e6;
        println!(
            "input method round trip over {N}: p50 {:.0} µs, p90 {:.0} µs, p99 {:.0} µs, max {:.0} µs",
            at(0.5),
            at(0.9),
            at(0.99),
            times[N - 1].as_secs_f64() * 1e6
        );
        assert!(times[N / 2] < Duration::from_millis(2));
    }

    /// Against the real built input method, run by hand:
    /// `VOICEBOX_INPUT_SOCKET=/tmp/vbim/im.sock .../VoiceboxInput` then
    /// `VBIM_SOCKET=/tmp/vbim/im.sock cargo test input_method::tests::live -- --ignored --nocapture`.
    /// With no field attached it declines.
    #[test]
    #[ignore]
    fn live_input_method_declines_without_a_field() {
        let socket = std::env::var("VBIM_SOCKET").expect("VBIM_SOCKET");
        let im = InputMethod::with_socket(socket);
        let mut times = Vec::new();
        for _ in 0..200 {
            let started = Instant::now();
            let attempt = im.attempt(&request("x"));
            times.push(started.elapsed());
            assert_eq!(attempt, Attempt::Declined("no active text field".into()));
        }
        times.sort();
        println!(
            "live round trip: p50 {:.0} µs, p99 {:.0} µs",
            times[100].as_secs_f64() * 1e6,
            times[198].as_secs_f64() * 1e6
        );
    }
}

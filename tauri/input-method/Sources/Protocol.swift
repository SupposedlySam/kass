// The wire protocol and the insert decision, kept free of InputMethodKit so
// the test executable (Tests/main.swift) can compile and run them alone.
//
// Protocol: one newline-terminated JSON object each way per connection.
//
//   request   {"v":1,"bundle_id":"com.tinyspeck.slackmacgap","text":"..."}
//   response  {"result":"inserted","verified":true}
//             {"result":"declined","reason":"..."}
//             {"result":"uncertain","reason":"..."}
//
// The one rule: "declined" means nothing was inserted. Once insertText has
// been called, the answer is "inserted" (verified or not), never "declined".
// The Rust client is tauri/src-tauri/src/input_method.rs.

import Foundation

let protocolVersion = 1

/// Longest request line accepted, in bytes. A dictation is far smaller.
let maxRequestBytes = 1 << 20

/// A request older than this when it reaches the main thread is declined
/// without inserting. The client gives up after its own read timeout, and a
/// late insert it no longer waits for would be a surprise.
let staleAfter: TimeInterval = 0.25

struct InsertRequest: Equatable {
    let bundleID: String
    let text: String
}

enum Response: Equatable {
    case inserted(verified: Bool)
    case declined(String)
    case uncertain(String)

    /// One JSON line, newline included.
    func encoded() -> Data {
        let object: [String: Any]
        switch self {
        case .inserted(let verified):
            object = ["result": "inserted", "verified": verified]
        case .declined(let reason):
            object = ["result": "declined", "reason": reason]
        case .uncertain(let reason):
            object = ["result": "uncertain", "reason": reason]
        }
        var data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
            ?? Data(#"{"reason":"encoding failed","result":"uncertain"}"#.utf8)
        data.append(0x0A)
        return data
    }
}

enum ParseResult: Equatable {
    case request(InsertRequest)
    case invalid(String)
}

/// Parse one request line (without its newline).
func parseRequest(_ line: Data) -> ParseResult {
    if line.count > maxRequestBytes { return .invalid("request too large") }
    guard let object = try? JSONSerialization.jsonObject(with: line),
          let dict = object as? [String: Any]
    else { return .invalid("request is not a JSON object") }
    guard let version = dict["v"] as? Int, version == protocolVersion else {
        return .invalid("unsupported protocol version")
    }
    guard let bundleID = dict["bundle_id"] as? String, !bundleID.isEmpty else {
        return .invalid("missing bundle_id")
    }
    guard let text = dict["text"] as? String else { return .invalid("missing text") }
    return .request(InsertRequest(bundleID: bundleID, text: text))
}

/// Apps where input-method text is not what the user sees as the field
/// (terminals). Mirrors CLIPBOARD_ONLY_BUNDLES in text_insert.rs.
let declinedBundles: Set<String> = [
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "dev.warp.Warp-Stable",
    "net.kovidgoyal.kitty",
    "com.github.wez.wezterm",
    "org.alacritty",
    "io.alacritty",
    "com.mitchellh.ghostty",
]

/// The text field the input method is attached to. The real one wraps an
/// IMK client; tests use a fake.
protocol TextClient: AnyObject {
    var bundleID: String? { get }
    /// The selection, or nil when the client can't report it.
    func selection() -> NSRange?
    /// The text at `range`, or nil when the client can't report it.
    func text(in range: NSRange) -> String?
    /// Insert `text` at the selection, replacing it.
    func insert(_ text: String)
}

/// Why a request must be declined before anything is inserted, or nil.
func declineReason(for request: InsertRequest, client: TextClient?, age: TimeInterval) -> String? {
    if request.text.isEmpty { return "empty text" }
    if age > staleAfter { return "request arrived too late" }
    guard let client else { return "no active text field" }
    guard let bundleID = client.bundleID, !bundleID.isEmpty else {
        return "active field's app is unknown"
    }
    if bundleID != request.bundleID {
        return "active field belongs to \(bundleID), not \(request.bundleID)"
    }
    if declinedBundles.contains(bundleID) { return "terminal" }
    return nil
}

/// Whether the field looks exactly as inserting `text` at `before` predicts:
/// an empty selection just past the new text, and (when readable) the new
/// text in front of it.
func verifyInsertion(text: String, before: NSRange?, after: NSRange?, inserted: String?) -> Bool {
    guard let before, let after, before.location != NSNotFound, after.location != NSNotFound
    else { return false }
    let length = (text as NSString).length
    guard after.length == 0, after.location == before.location + length else { return false }
    if let inserted, inserted != text { return false }
    return true
}

/// Handle one request against the active client. Must run on the main
/// thread for a real IMK client.
func perform(_ request: InsertRequest, client: TextClient?, age: TimeInterval) -> Response {
    if let reason = declineReason(for: request, client: client, age: age) {
        return .declined(reason)
    }
    let client = client!
    let before = client.selection()
    client.insert(request.text)
    guard let before, before.location != NSNotFound else { return .inserted(verified: false) }
    let after = client.selection()
    let length = (request.text as NSString).length
    let inserted = client.text(in: NSRange(location: before.location, length: length))
    return .inserted(verified: verifyInsertion(
        text: request.text, before: before, after: after, inserted: inserted))
}

/// Handle one raw request line.
func respond(to line: Data, client: TextClient?, age: TimeInterval) -> Response {
    switch parseRequest(line) {
    case .invalid(let reason): return .declined(reason)
    case .request(let request): return perform(request, client: client, age: age)
    }
}

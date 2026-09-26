// Tests for Protocol.swift, compiled with it into a small executable by
// scripts/test-input-method.sh. No XCTest: the Command Line Tools don't
// ship it.

import Foundation

var failures = 0
var passed = 0

func check(_ condition: Bool, _ message: String, line: Int = #line) {
    if condition {
        passed += 1
    } else {
        failures += 1
        print("FAIL (line \(line)): \(message)")
    }
}

func eq<T: Equatable>(_ a: T, _ b: T, _ message: String = "", line: Int = #line) {
    check(a == b, "\(message) expected \(b), got \(a)", line: line)
}

/// A text field kept as a string plus a selection, like a real client.
final class FakeClient: TextClient {
    var bundleID: String?
    var value: String
    var sel: NSRange?
    var readable = true
    var insertCalls: [String] = []
    /// Simulates an app that ignores the insert.
    var ignoresInsert = false

    init(bundleID: String?, value: String = "", caret: Int? = nil) {
        self.bundleID = bundleID
        self.value = value
        self.sel = NSRange(location: caret ?? (value as NSString).length, length: 0)
    }

    func selection() -> NSRange? { readable ? sel : nil }

    func text(in range: NSRange) -> String? {
        guard readable, NSMaxRange(range) <= (value as NSString).length else { return nil }
        return (value as NSString).substring(with: range)
    }

    func insert(_ text: String) {
        insertCalls.append(text)
        if ignoresInsert { return }
        let range = sel ?? NSRange(location: (value as NSString).length, length: 0)
        value = (value as NSString).replacingCharacters(in: range, with: text)
        sel = NSRange(location: range.location + (text as NSString).length, length: 0)
    }
}

func line(_ object: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

func decode(_ data: Data) -> [String: Any] {
    check(data.last == 0x0A, "response ends with a newline")
    return (try? JSONSerialization.jsonObject(with: data.dropLast())) as? [String: Any] ?? [:]
}

let slack = "com.tinyspeck.slackmacgap"

// ─── parseRequest ─────────────────────────────────────────────────────

for text in ["hello", "héllo wörld", "emoji 👩‍💻🎉", "line\nbreak\r\n", "quote \" and \\ back", "\t", ""] {
    let parsed = parseRequest(line(["v": 1, "bundle_id": slack, "text": text]))
    eq(parsed, .request(InsertRequest(bundleID: slack, text: text)), "round trip \(text.debugDescription)")
}
// The exact bytes the Rust client sends.
eq(parseRequest(Data(#"{"v":1,"bundle_id":"a.b","text":"x\ny \"q\" 🎉"}"#.utf8)),
   .request(InsertRequest(bundleID: "a.b", text: "x\ny \"q\" 🎉")), "rust bytes")
eq(parseRequest(Data("garbage".utf8)), .invalid("request is not a JSON object"))
eq(parseRequest(Data("[1,2]".utf8)), .invalid("request is not a JSON object"))
eq(parseRequest(Data(#"{"v":1,"bundle_id":"a.b","te"#.utf8)), .invalid("request is not a JSON object"), "partial")
eq(parseRequest(line(["v": 2, "bundle_id": slack, "text": "x"])), .invalid("unsupported protocol version"))
eq(parseRequest(line(["bundle_id": slack, "text": "x"])), .invalid("unsupported protocol version"))
eq(parseRequest(line(["v": 1, "text": "x"])), .invalid("missing bundle_id"))
eq(parseRequest(line(["v": 1, "bundle_id": "", "text": "x"])), .invalid("missing bundle_id"))
eq(parseRequest(line(["v": 1, "bundle_id": slack])), .invalid("missing text"))
eq(parseRequest(line(["v": 1, "bundle_id": slack, "text": 5])), .invalid("missing text"))
eq(parseRequest(Data(count: maxRequestBytes + 1)), .invalid("request too large"))

// ─── Response encoding ────────────────────────────────────────────────

let ins = decode(Response.inserted(verified: true).encoded())
eq(ins["result"] as? String, "inserted")
eq(ins["verified"] as? Bool, true)
eq(decode(Response.inserted(verified: false).encoded())["verified"] as? Bool, false)
let dec = decode(Response.declined("no \"field\"\nhere").encoded())
eq(dec["result"] as? String, "declined")
eq(dec["reason"] as? String, "no \"field\"\nhere")
eq(decode(Response.uncertain("hm").encoded())["result"] as? String, "uncertain")
eq(String(decoding: Response.inserted(verified: true).encoded(), as: UTF8.self),
   "{\"result\":\"inserted\",\"verified\":true}\n", "exact inserted bytes")
check(!Response.declined("a\nb").encoded().dropLast().contains(0x0A), "newline in reason is escaped")

// ─── declineReason ────────────────────────────────────────────────────

let req = InsertRequest(bundleID: slack, text: "hi")
eq(declineReason(for: req, client: nil, age: 0), "no active text field")
eq(declineReason(for: req, client: FakeClient(bundleID: nil), age: 0), "active field's app is unknown")
eq(declineReason(for: req, client: FakeClient(bundleID: ""), age: 0), "active field's app is unknown")
eq(declineReason(for: req, client: FakeClient(bundleID: "com.other"), age: 0),
   "active field belongs to com.other, not \(slack)")
eq(declineReason(for: InsertRequest(bundleID: "com.apple.Terminal", text: "ls"),
                 client: FakeClient(bundleID: "com.apple.Terminal"), age: 0), "terminal")
eq(declineReason(for: InsertRequest(bundleID: slack, text: ""), client: FakeClient(bundleID: slack), age: 0),
   "empty text")
eq(declineReason(for: req, client: FakeClient(bundleID: slack), age: staleAfter + 0.01), "request arrived too late")
eq(declineReason(for: req, client: FakeClient(bundleID: slack), age: 0), nil)

// ─── verifyInsertion ──────────────────────────────────────────────────

let r = { (l: Int, n: Int) in NSRange(location: l, length: n) }
check(verifyInsertion(text: "hi", before: r(3, 0), after: r(5, 0), inserted: "hi"), "caret moved by 2")
check(verifyInsertion(text: "hi", before: r(3, 4), after: r(5, 0), inserted: nil), "replaced selection")
check(verifyInsertion(text: "🎉", before: r(0, 0), after: r(2, 0), inserted: "🎉"), "emoji is 2 UTF-16 units")
check(!verifyInsertion(text: "🎉", before: r(0, 0), after: r(1, 0), inserted: nil), "not 1 unit")
check(!verifyInsertion(text: "hi", before: r(3, 0), after: r(3, 0), inserted: nil), "caret didn't move")
check(!verifyInsertion(text: "hi", before: r(3, 0), after: r(5, 1), inserted: nil), "selection not empty")
check(!verifyInsertion(text: "hi", before: r(3, 0), after: r(5, 0), inserted: "Hi"), "autocorrected")
check(!verifyInsertion(text: "hi", before: nil, after: r(5, 0), inserted: "hi"), "before unreadable")
check(!verifyInsertion(text: "hi", before: r(3, 0), after: nil, inserted: "hi"), "after unreadable")
check(!verifyInsertion(text: "hi", before: r(NSNotFound, 0), after: r(5, 0), inserted: nil), "NSNotFound")

// ─── perform ──────────────────────────────────────────────────────────

do {
    let client = FakeClient(bundleID: slack, value: "Hello ", caret: 6)
    eq(perform(InsertRequest(bundleID: slack, text: "world 🌍"), client: client, age: 0),
       .inserted(verified: true), "inserts and verifies")
    eq(client.value, "Hello world 🌍")
}
do {
    let client = FakeClient(bundleID: slack, value: "abc", caret: 1)
    eq(perform(InsertRequest(bundleID: slack, text: "X\nY"), client: client, age: 0), .inserted(verified: true))
    eq(client.value, "aX\nYbc", "inserts at the caret")
}
do {
    let client = FakeClient(bundleID: slack, value: "abc")
    client.readable = false
    eq(perform(req, client: client, age: 0), .inserted(verified: false), "unreadable before: sent, unverified")
    eq(client.insertCalls, ["hi"])
}
do {
    let client = FakeClient(bundleID: slack, value: "abc")
    client.ignoresInsert = true
    eq(perform(req, client: client, age: 0), .inserted(verified: false),
       "insert called but not seen: never reported as declined")
}
for (client, why) in [(FakeClient(bundleID: "com.other"), "wrong app"),
                      (FakeClient(bundleID: "com.apple.Terminal"), "terminal")] {
    let request = InsertRequest(bundleID: client.bundleID!, text: "x")
    let wrong = why == "wrong app" ? req : request
    if case .declined = perform(wrong, client: client, age: 0) {} else { check(false, "\(why) declines") }
    eq(client.insertCalls, [], "\(why): nothing inserted")
}
do {
    let client = FakeClient(bundleID: slack)
    if case .declined = perform(req, client: client, age: 1) {} else { check(false, "stale declines") }
    eq(client.insertCalls, [], "stale: nothing inserted")
}

// ─── respond ──────────────────────────────────────────────────────────

do {
    let client = FakeClient(bundleID: slack)
    eq(respond(to: Data("{not json".utf8), client: client, age: 0), .declined("request is not a JSON object"))
    eq(client.insertCalls, [], "garbage: nothing inserted")
    eq(respond(to: line(["v": 1, "bundle_id": slack, "text": "ok"]), client: client, age: 0),
       .inserted(verified: true))
    eq(client.value, "ok")
}

print("\(passed) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)

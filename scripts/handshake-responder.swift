// A stand-in for an app that takes part in Kass's dictation handshake
// (docs/DICTATION_HANDSHAKE.md). It registers its pid, answers every
// dictationWillBegin meant for it with dictationReady, and prints what Kass
// sends. Use it to check the round trip:
//
//   swift scripts/handshake-responder.swift [--delay-ms N]
//
// --delay-ms waits before replying, to see Kass's timeout.

import Foundation

let center = DistributedNotificationCenter.default()
let pid = Int(ProcessInfo.processInfo.processIdentifier)
var delayMs = 0
if let i = CommandLine.arguments.firstIndex(of: "--delay-ms"), i + 1 < CommandLine.arguments.count {
    delayMs = Int(CommandLine.arguments[i + 1]) ?? 0
}

func forMe(_ note: Notification) -> Bool {
    (note.userInfo?["pid"] as? NSNumber)?.intValue == pid
}

center.addObserver(forName: Notification.Name("com.mrgnhnt.kass.dictationWillBegin"), object: nil, queue: nil) { note in
    guard forMe(note) else { return }
    let mode = note.userInfo?["mode"] as? String ?? "?"
    print("willBegin mode=\(mode)")
    // A real app shows and focuses its text field here, then replies.
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(delayMs)) {
        center.postNotificationName(
            Notification.Name("com.mrgnhnt.kass.dictationReady"),
            object: nil, userInfo: ["pid": pid], deliverImmediately: true)
    }
}

center.addObserver(forName: Notification.Name("com.mrgnhnt.kass.dictationDidEnd"), object: nil, queue: nil) { note in
    guard forMe(note) else { return }
    print("didEnd outcome=\(note.userInfo?["outcome"] as? String ?? "?")")
}

// Register at launch (a bundled app can set KassDictationHandshake in its
// Info.plist instead). Repeat it now and then so a Kass started later sees it.
func register() {
    center.postNotificationName(
        Notification.Name("com.mrgnhnt.kass.handshakeSupported"),
        object: nil, userInfo: ["pid": pid], deliverImmediately: true)
}
register()
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in register() }

print("responder pid \(pid), reply delay \(delayMs)ms")
setvbuf(stdout, nil, _IOLBF, 0)
RunLoop.main.run()

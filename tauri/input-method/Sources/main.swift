// Voicebox Input: an InputMethodKit input method that types nothing itself
// and inserts dictated text Voicebox sends it. See InputController.swift and
// Protocol.swift.

import Cocoa
import InputMethodKit

let connectionName = Bundle.main.infoDictionary?["InputMethodConnectionName"] as? String
    ?? "sh.voicebox.inputmethod.VoiceboxInput_Connection"

guard let imkServer = IMKServer(name: connectionName, bundleIdentifier: Bundle.main.bundleIdentifier)
else {
    NSLog("VoiceboxInput: could not start the IMK server")
    exit(1)
}

// VOICEBOX_INPUT_SOCKET overrides the path, for trying the binary by hand.
let socketPath = ProcessInfo.processInfo.environment["VOICEBOX_INPUT_SOCKET"] ?? defaultSocketPath()
let socketServer = SocketServer(path: socketPath) { line, waited in
    // Timed from when the request arrived to when the main thread runs it.
    let arrived = Date().addingTimeInterval(-waited)
    return DispatchQueue.main.sync {
        respond(to: line, client: ActiveClient.client, age: Date().timeIntervalSince(arrived))
    }
}
do {
    try socketServer.start()
} catch {
    NSLog("VoiceboxInput: socket server failed: %@", "\(error)")
}

withExtendedLifetime(imkServer) {
    NSApplication.shared.run()
}

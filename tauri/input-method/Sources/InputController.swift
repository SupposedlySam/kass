// The input method itself: a pass-through keyboard that also inserts text
// Voicebox sends over the socket.
//
// handle(_:client:) returns false for every event, so every key goes to the
// app exactly as with the ABC layout. Keep "Voicebox Input" selected as the
// keyboard; while it is, InputMethodKit keeps a controller attached to the
// focused text field, and that is the client dictated text goes into.

import Cocoa
import InputMethodKit

/// The client of the most recently activated controller. Main thread only.
enum ActiveClient {
    static weak var controller: VoiceboxInputController?
    static var client: IMKClient?
}

/// An IMK client as a TextClient.
final class IMKClient: TextClient {
    let proxy: IMKTextInput & NSObjectProtocol

    init(_ proxy: IMKTextInput & NSObjectProtocol) {
        self.proxy = proxy
    }

    var bundleID: String? { proxy.bundleIdentifier() }

    func selection() -> NSRange? {
        let range = proxy.selectedRange()
        return range.location == NSNotFound ? nil : range
    }

    func text(in range: NSRange) -> String? {
        proxy.attributedSubstring(from: range)?.string
    }

    func insert(_ text: String) {
        proxy.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
    }
}

@objc(VoiceboxInputController)
final class VoiceboxInputController: IMKInputController {
    override func activateServer(_ sender: Any!) {
        super.activateServer(sender)
        guard let proxy = sender as? (IMKTextInput & NSObjectProtocol) else { return }
        ActiveClient.controller = self
        ActiveClient.client = IMKClient(proxy)
    }

    override func deactivateServer(_ sender: Any!) {
        // Another controller may already have activated; only clear our own.
        if ActiveClient.controller === self {
            ActiveClient.controller = nil
            ActiveClient.client = nil
        }
        super.deactivateServer(sender)
    }

    /// Pass every event through to the app.
    override func handle(_ event: NSEvent!, client sender: Any!) -> Bool {
        false
    }
}

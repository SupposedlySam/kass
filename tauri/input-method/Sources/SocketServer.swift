// The Unix domain socket Voicebox sends insert requests to.
//
// One background thread accepts connections and serves them one at a time:
// read one request line, hop to the main thread (InputMethodKit is
// main-thread only), write one response line, close.

import Darwin
import Foundation

/// ~/Library/Application Support/sh.voicebox.app/input-method.sock. The Rust
/// client (input_method.rs, default_socket_path) uses the same path.
func defaultSocketPath() -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return home + "/Library/Application Support/sh.voicebox.app/input-method.sock"
}

final class SocketServer {
    private let path: String
    private let handle: (Data, TimeInterval) -> Response
    private var listener: Int32 = -1

    /// `handle` gets the request line and the time it has waited, and runs
    /// on the accept thread; it hops to the main thread itself.
    init(path: String, handle: @escaping (Data, TimeInterval) -> Response) {
        self.path = path
        self.handle = handle
    }

    func start() throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        unlink(path)  // a socket left by a previous run

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw posixError("socket") }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd)
            throw NSError(domain: "VoiceboxInput", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "socket path too long: \(path)"])
        }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: bytes)
            raw[bytes.count] = 0
        }
        // Owner-only from the moment it exists.
        let oldMask = umask(0o077)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        umask(oldMask)
        guard bound == 0 else {
            close(fd)
            throw posixError("bind")
        }
        chmod(path, 0o600)
        guard listen(fd, 8) == 0 else {
            close(fd)
            throw posixError("listen")
        }
        listener = fd

        let thread = Thread { [self] in acceptLoop() }
        thread.name = "VoiceboxInput.socket"
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    private func acceptLoop() {
        while true {
            let conn = accept(listener, nil, nil)
            if conn < 0 {
                if errno == EINTR { continue }
                NSLog("VoiceboxInput: accept failed: %d", errno)
                return
            }
            serve(conn)
            close(conn)
        }
    }

    private func serve(_ conn: Int32) {
        var on: Int32 = 1
        setsockopt(conn, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        // A client that connects and never sends must not hold up the next.
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(conn, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(conn, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        guard let (line, received) = readLine(conn) else { return }
        let response = handle(line, Date().timeIntervalSince(received))
        let data = response.encoded()
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = write(conn, raw.baseAddress! + offset, raw.count - offset)
                if n <= 0 { return }
                offset += n
            }
        }
    }

    /// One line without its newline, and when its first byte arrived. Nil
    /// when the client closes or times out before a full line, or sends too
    /// much: nothing is inserted for an incomplete request.
    private func readLine(_ conn: Int32) -> (Data, Date)? {
        var line = Data()
        var received: Date?
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let n = read(conn, &buffer, buffer.count)
            if n < 0 && errno == EINTR { continue }
            if n <= 0 { return nil }
            if received == nil { received = Date() }
            if let newline = buffer[0..<n].firstIndex(of: 0x0A) {
                line.append(contentsOf: buffer[0..<newline])
                return (line, received!)
            }
            line.append(contentsOf: buffer[0..<n])
            if line.count > maxRequestBytes { return nil }
        }
    }

    private func posixError(_ call: String) -> NSError {
        let code = errno
        return NSError(domain: NSPOSIXErrorDomain, code: Int(code),
                       userInfo: [NSLocalizedDescriptionKey: "\(call): \(String(cString: strerror(code)))"])
    }
}

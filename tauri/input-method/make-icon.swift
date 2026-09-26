// Draws Resources/icon.tiff, the input menu icon: a black "V" in a rounded
// square, at 16 and 32 px (1x and 2x). Run once when the design changes:
//   swift tauri/input-method/make-icon.swift tauri/input-method/Resources/icon.tiff

import Cocoa

let output = CommandLine.arguments.dropFirst().first ?? "icon.tiff"
let image = NSImage(size: NSSize(width: 16, height: 16))

for scale in [1, 2] {
    let px = 16 * scale
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: 16, height: 16)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let box = NSRect(x: 1, y: 1, width: 14, height: 14)
    NSColor.black.setStroke()
    let border = NSBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), xRadius: 3, yRadius: 3)
    border.lineWidth = 1
    border.stroke()

    let v = NSBezierPath()
    v.move(to: NSPoint(x: 4.5, y: 11.5))
    v.line(to: NSPoint(x: 8, y: 4))
    v.line(to: NSPoint(x: 11.5, y: 11.5))
    v.lineWidth = 1.75
    v.lineCapStyle = .round
    v.lineJoinStyle = .round
    v.stroke()

    NSGraphicsContext.restoreGraphicsState()
    image.addRepresentation(rep)
}

guard let tiff = image.tiffRepresentation else { fatalError("no TIFF") }
try! tiff.write(to: URL(fileURLWithPath: output))
print("wrote \(output)")

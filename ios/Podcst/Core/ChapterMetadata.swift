import CryptoKit
import Foundation
import ImageIO
import UIKit

public struct ChapterArtwork: Hashable, Sendable {
    public let id: String
    public let data: Data

    init?(_ data: Data) {
        guard !data.isEmpty, data.count <= 4 * 1024 * 1024,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 16_384, height <= 16_384 else { return nil }
        self.data = data
        id = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func image(pixelSize: Int = 1024) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: pixelSize,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    public static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct ChapterMetadata: Sendable {
    let entries: [Chapter]
    let navigation: [Chapter]
    private let hidden: [Chapter]

    init(_ entries: [Chapter] = []) {
        self.entries = entries.filter { $0.start.isFinite && $0.start >= 0 }
            .sorted { $0.start < $1.start }
        var starts = Set<TimeInterval>()
        navigation = self.entries.filter { !$0.isHidden && starts.insert($0.start).inserted }
        hidden = self.entries.filter(\.isHidden)
    }

    func artwork(at time: TimeInterval, duration: TimeInterval) -> ChapterArtwork? {
        guard time.isFinite, time >= 0 else { return nil }
        let visible = navigation
        for (index, chapter) in hidden.enumerated().reversed() where chapter.start <= time {
            let end = chapter.end ?? (index + 1 < hidden.count ? hidden[index + 1].start : duration)
            if time < end, let artwork = chapter.artwork { return artwork }
        }
        guard let index = visible.index(at: time) else { return nil }
        let chapter = visible[index]
        let end = min(chapter.end ?? .infinity, visible.end(of: index, duration: duration))
        return time < end ? chapter.artwork : nil
    }
}

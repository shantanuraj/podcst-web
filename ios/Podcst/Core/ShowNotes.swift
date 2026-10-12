import Foundation
import UIKit

public struct Chapter: Hashable, Sendable {
    public let title: String
    public let start: TimeInterval
    public let end: TimeInterval?
    public let artwork: ChapterArtwork?
    public let isHidden: Bool

    public init(title: String, start: TimeInterval, end: TimeInterval? = nil, artwork: ChapterArtwork? = nil, isHidden: Bool = false) {
        self.title = title
        self.start = start
        self.end = end
        self.artwork = artwork
        self.isHidden = isHidden
    }
}

extension [Chapter] {
    func index(at time: TimeInterval) -> Int? {
        lastIndex { $0.start <= time }
    }

    func end(of index: Int, duration: TimeInterval) -> TimeInterval {
        index + 1 < count ? self[index + 1].start : Swift.max(duration, self[index].start)
    }
}

enum ShowNotesParser {
    private static let timestampPattern = #"(?<![A-Za-z0-9])(?:[0-9]{1,2}:)?[0-9]{1,2}:[0-5][0-9](?![A-Za-z0-9])"#
    private static let timestampRegex = try! NSRegularExpression(pattern: timestampPattern)
    private static let chapterRegex = try! NSRegularExpression(pattern: #"^\s*[\p{P}\p{S}]*\s*(\#(timestampPattern))(?:[\])]\s*|[\p{Pd}|.]\s*|:(?![0-9])\s*|\s+)(.+?)\s*$"#)
    private static let trailingChapterRegex = try! NSRegularExpression(pattern: #"^(.*\S)\s+(?:\(([^()]*)\)|\[([^\[\]]*)\]|[\p{Pd}|]\s+(\S+))\s*$"#)

    static func notes(of episode: Episode) -> String {
        episode.showNotes.isEmpty ? episode.summary ?? "" : episode.showNotes
    }

    static func attributedString(_ html: String) -> AttributedString {
        guard let data = html.data(using: .utf8), let parsed = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else {
            return AttributedString(html.strippingHTML)
        }
        let mutable = NSMutableAttributedString(attributedString: parsed)
        let fullRange = NSRange(location: 0, length: mutable.length)
        mutable.removeAttribute(.foregroundColor, range: fullRange)
        mutable.removeAttribute(.backgroundColor, range: fullRange)
        mutable.removeAttribute(.font, range: fullRange)
        let plain = mutable.string
        for match in timestampRegex.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
            let timestamp = (plain as NSString).substring(with: match.range)
            if let url = timestampURL(timestamp) {
                mutable.addAttribute(.link, value: url, range: match.range)
            }
        }
        return AttributedString(mutable)
    }

    static func chapters(_ html: String) -> [Chapter] {
        let text = html
            .replacingOccurrences(of: #"<(br|/p|/li|/div|/h[1-6])[^>]*>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
            .strippingHTML
        let chapters = text.split(whereSeparator: \.isNewline).compactMap { line -> Chapter? in
            let line = line.trimmingCharacters(in: .whitespaces)
            let range = NSRange(line.startIndex..., in: line)
            let leading = chapterRegex.firstMatch(in: line, range: range)
            let trailing = leading == nil ? trailingChapterRegex.firstMatch(in: line, range: range) : nil
            guard let match = leading ?? trailing,
                  let timestamp = (leading == nil ? [2, 3, 4] : [1]).compactMap({ Range(match.range(at: $0), in: line) }).first,
                  let title = Range(match.range(at: leading == nil ? 1 : 2), in: line) else { return nil }
            let value = line[timestamp].trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: #"^(?:(?:story|chapter|segment)\s+)?starts?\s+(?:at|around)\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
            let timestampRange = NSRange(value.startIndex..., in: value)
            guard timestampRegex.firstMatch(in: value, range: timestampRange)?.range == timestampRange,
                  let start = seconds(from: value) else { return nil }
            let name = line[title].trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: #"^[\p{Pd}:|.]+\s+"#, with: "", options: .regularExpression)
            return name.isEmpty ? nil : Chapter(title: name, start: start)
        }
        guard chapters.count >= 2, zip(chapters, chapters.dropFirst()).allSatisfy({ $0.start < $1.start }) else { return [] }
        return chapters
    }

    static func timestamps(_ text: String) -> [String] {
        timestampRegex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { (text as NSString).substring(with: $0.range) }
    }

    static func timestampURL(_ timestamp: String) -> URL? {
        var components = URLComponents()
        components.scheme = "podcst"
        components.host = "timestamp"
        components.queryItems = [URLQueryItem(name: "value", value: timestamp)]
        return components.url
    }

    static func timestamp(from url: URL) -> TimeInterval? {
        guard url.scheme == "podcst", url.host == "timestamp",
              let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "value" })?.value else { return nil }
        return seconds(from: value)
    }

    static func seconds(from timestamp: String) -> TimeInterval? {
        let parts = timestamp.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 || parts.count == 3, parts.last! < 60 else { return nil }
        if parts.count == 2 { return TimeInterval(parts[0] * 60 + parts[1]) }
        guard parts[1] < 60 else { return nil }
        return TimeInterval(parts[0] * 3600 + parts[1] * 60 + parts[2])
    }
}

extension String {
    var strippingHTML: String {
        replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&quot;", with: "\"")
    }
}

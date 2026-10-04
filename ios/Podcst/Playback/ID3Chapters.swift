import Foundation

struct ID3Chapters {
    static let maximumTagBytes = 16 * 1024 * 1024
    private struct Frame {
        let id: String
        let body: Data
    }
    private struct Contents {
        let topLevel: Bool
        let children: [String]
    }
    private enum Invalid: Error { case metadata }

    static func tagSize(_ header: Data) -> Int? {
        guard header.count >= 10, header.prefix(3) == Data("ID3".utf8),
              [3, 4].contains(header[3]), header[4] == 0,
              header[5] & (header[3] == 4 ? 0xef : 0xff) == 0,
              let size = try? number(Data(header[6..<10]), syncsafe: true),
              size + 10 <= maximumTagBytes else { return nil }
        return size + 10
    }

    static func parse(_ data: Data) -> ChapterMetadata? {
        guard let size = tagSize(data), size == data.count else { return nil }
        return try? decode(data, version: Int(data[3]))
    }

    private static func decode(_ data: Data, version: Int) throws -> ChapterMetadata {
        let frames = try frames(Data(data.dropFirst(10)), version: version)
        var chapters: [(String, Chapter)] = []
        var contents: [String: Contents] = [:]
        var ids = Set<String>()
        for frame in frames where frame.id == "CHAP" || frame.id == "CTOC" {
            var cursor = 0
            let id = try terminated(frame.body, cursor: &cursor)
            if frame.id == "CTOC" {
                guard cursor + 2 <= frame.body.count else { throw Invalid.metadata }
                let flags = frame.body[cursor]
                let count = Int(frame.body[cursor + 1])
                cursor += 2
                let children = try (0..<count).map { _ in try terminated(frame.body, cursor: &cursor) }
                if contents[id] == nil { contents[id] = Contents(topLevel: flags & 2 != 0, children: children) }
                continue
            }
            guard cursor + 16 <= frame.body.count else { throw Invalid.metadata }
            let start = try number(Data(frame.body[cursor..<cursor + 4]))
            let end = try number(Data(frame.body[cursor + 4..<cursor + 8]))
            cursor += 16
            let nested = try self.frames(Data(frame.body.dropFirst(cursor)), version: version)
            guard !nested.contains(where: { $0.id == "CHAP" || $0.id == "CTOC" }) else { throw Invalid.metadata }
            guard start != 0xffffffff, end == 0xffffffff || end > start, ids.insert(id).inserted else { continue }
            guard chapters.count < 1000 else { throw Invalid.metadata }
            let title = nested.first { $0.id == "TIT2" }.flatMap { text($0.body) } ?? ""
            let artwork = nested.filter { $0.id == "APIC" }.lazy.compactMap { picture($0.body) }.first
            chapters.append((id, Chapter(title: title, start: Double(start) / 1000,
                                         end: end == 0xffffffff ? nil : Double(end) / 1000, artwork: artwork)))
        }
        var pending = contents.filter { $0.value.topLevel }.map(\.key)
        let hasTable = !pending.isEmpty
        var visible = Set<String>()
        while let id = pending.popLast() {
            guard visible.insert(id).inserted else { continue }
            pending.append(contentsOf: contents[id]?.children ?? [])
        }
        var number = 0
        return ChapterMetadata(chapters.sorted { $0.1.start < $1.1.start }.map { id, chapter in
            let hidden = hasTable && !visible.contains(id)
            if !hidden { number += 1 }
            let title = chapter.title.trimmingCharacters(in: .whitespacesAndNewlines)
            return Chapter(title: title.isEmpty && !hidden ? "Chapter \(number)" : title,
                           start: chapter.start, end: chapter.end, artwork: chapter.artwork, isHidden: hidden)
        })
    }

    private static func frames(_ data: Data, version: Int) throws -> [Frame] {
        var result: [Frame] = []
        var cursor = 0
        while cursor < data.count {
            if data[cursor] == 0 {
                guard data[cursor...].allSatisfy({ $0 == 0 }) else { throw Invalid.metadata }
                break
            }
            guard result.count < 4096, cursor + 10 <= data.count else { throw Invalid.metadata }
            let id = Data(data[cursor..<cursor + 4])
            guard id.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }),
                  data[cursor + 9] == 0 else { throw Invalid.metadata }
            let size = try number(Data(data[cursor + 4..<cursor + 8]), syncsafe: version == 4)
            cursor += 10
            guard size <= data.count - cursor else { throw Invalid.metadata }
            result.append(Frame(id: String(decoding: id, as: UTF8.self), body: Data(data[cursor..<cursor + size])))
            cursor += size
        }
        return result
    }

    private static func number(_ data: Data, syncsafe: Bool = false) throws -> Int {
        guard !syncsafe || data.allSatisfy({ $0 < 128 }) else { throw Invalid.metadata }
        return data.reduce(0) { $0 * (syncsafe ? 128 : 256) + Int($1) }
    }

    private static func terminated(_ data: Data, cursor: inout Int) throws -> String {
        guard cursor < data.count, let end = data[cursor...].firstIndex(of: 0) else { throw Invalid.metadata }
        let value = String(data: data[cursor..<end], encoding: .isoLatin1) ?? ""
        cursor = end + 1
        return value
    }

    private static func text(_ data: Data) -> String? {
        guard let byte = data.first else { return nil }
        let encoding: String.Encoding
        switch byte {
        case 0: encoding = .isoLatin1
        case 1: encoding = .utf16
        case 2: encoding = .utf16BigEndian
        case 3: encoding = .utf8
        default: return nil
        }
        return String(data: data.dropFirst(), encoding: encoding)?.trimmingCharacters(in: .controlCharacters)
    }

    private static func picture(_ data: Data) -> ChapterArtwork? {
        guard let encoding = data.first, encoding <= 3 else { return nil }
        var cursor = 1
        guard let mime = try? terminated(data, cursor: &cursor), ["image/jpeg", "image/png"].contains(mime.lowercased()),
              cursor < data.count else { return nil }
        cursor += 1
        let width = encoding == 1 || encoding == 2 ? 2 : 1
        while cursor + width <= data.count {
            if data[cursor..<cursor + width].allSatisfy({ $0 == 0 }) {
                return ChapterArtwork(Data(data.dropFirst(cursor + width)))
            }
            cursor += width
        }
        return nil
    }
}

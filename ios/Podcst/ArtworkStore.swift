import CryptoKit
import Foundation
import ImageIO
import Observation
import UIKit

struct ArtworkHue: Hashable, Sendable {
    let hue: CGFloat
    let saturation: CGFloat
}

enum ArtworkPolicy: Sendable {
    case memory
    case disk
}

@MainActor
@Observable
final class ArtworkStore {
    static let shared = ArtworkStore()
    private(set) var revision = 0
    @ObservationIgnored private var accountID: String?
    @ObservationIgnored private let rootURL: URL
    @ObservationIgnored private let session: URLSession
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let diskBudget: Int
    @ObservationIgnored private var storage: ArtworkStorage
    @ObservationIgnored private var scope = UUID()
    @ObservationIgnored private let images = NSCache<NSString, DecodedArtwork>()
    @ObservationIgnored private var requests: [String: Task<UIImage?, Never>] = [:]

    init(accountID: String? = nil, rootURL: URL? = nil, session: URLSession? = nil, now: @escaping @Sendable () -> Date = Date.init, diskBudget: Int = 64 * 1024 * 1024) {
        let root = rootURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Podcst/Artwork", isDirectory: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 3
        configuration.timeoutIntervalForRequest = 30
        let session = session ?? URLSession(configuration: configuration)
        self.accountID = accountID
        self.rootURL = root
        self.session = session
        self.now = now
        self.diskBudget = diskBudget
        storage = ArtworkStorage(root: root, accountID: accountID, session: session, now: now, budget: diskBudget)
        images.totalCostLimit = 32 * 1024 * 1024
        images.countLimit = 160
    }

    func configure(accountID: String?) {
        guard self.accountID != accountID else { return }
        self.accountID = accountID
        scope = UUID()
        requests.values.forEach { $0.cancel() }
        requests.removeAll()
        images.removeAllObjects()
        storage = ArtworkStorage(root: rootURL, accountID: accountID, session: session, now: now, budget: diskBudget)
        revision += 1
    }

    func switchAccount(to accountID: String?) async {
        guard self.accountID != accountID else { return }
        let previous = storage
        configure(accountID: accountID)
        await previous.invalidate()
    }

    func retain(_ urls: Set<URL>, accountID: String?) async {
        guard self.accountID == accountID else { return }
        await storage.retain(urls)
    }

    func prefetch(_ urls: [URL], pixelSize: Int) async {
        await storage.prefetch(urls, pixelSize: pixelSize)
    }

    static func pixelSize(for points: CGFloat, scale: CGFloat) -> Int {
        let pixels = max(1, Int(ceil(points * scale)))
        return [160, 384, 1024].first { $0 >= pixels } ?? pixels
    }

    func cached(_ url: URL?, pixelSize: Int) -> UIImage? {
        _ = revision
        guard let url else { return nil }
        return images.object(forKey: key(url, pixelSize) as NSString)?.image
    }

    func image(_ url: URL?, pixelSize: Int, policy: ArtworkPolicy = .disk) async -> UIImage? {
        guard let url, pixelSize > 0 else { return nil }
        let key = key(url, pixelSize)
        if let cached = images.object(forKey: key as NSString) {
            let storage = storage
            let scope = scope
            if policy == .disk { await storage.promote(url, pixelSize: pixelSize) }
            guard self.scope == scope else { return nil }
            if cached.expiresAt <= now() { refresh(url, pixelSize: pixelSize, policy: policy) }
            return cached.image
        }
        if let request = requests[key] {
            let storage = storage
            let scope = scope
            let image = await request.value
            guard self.scope == scope, image != nil else { return nil }
            if policy == .disk { await storage.promote(url, pixelSize: pixelSize) }
            return self.scope == scope ? image : nil
        }
        return await load(url, pixelSize: pixelSize, policy: policy, refreshing: false).value
    }

    private func refresh(_ url: URL, pixelSize: Int, policy: ArtworkPolicy) {
        let key = key(url, pixelSize)
        guard requests[key] == nil else { return }
        _ = load(url, pixelSize: pixelSize, policy: policy, refreshing: true)
    }

    private func load(_ url: URL, pixelSize: Int, policy: ArtworkPolicy, refreshing: Bool) -> Task<UIImage?, Never> {
        let key = key(url, pixelSize)
        let generation = scope
        let storage = storage
        let task = Task { [weak self] in
            let payload = await storage.load(url, pixelSize: pixelSize, policy: policy, refreshing: refreshing)
            guard let payload, !Task.isCancelled else {
                if self?.scope == generation { self?.requests[key] = nil }
                return self?.scope == generation ? self?.cached(url, pixelSize: pixelSize) : nil
            }
            let image = await Task.detached(priority: .utility) { ArtworkDecoder.image(payload.data, pixelSize: pixelSize) }.value
            guard let self, self.scope == generation, !Task.isCancelled else { return nil }
            self.requests[key] = nil
            if let image {
                let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
                self.images.setObject(DecodedArtwork(image: image, expiresAt: payload.expiresAt), forKey: key as NSString, cost: cost)
                self.revision += 1
            }
            if payload.expiresAt <= self.now(), !refreshing { self.refresh(url, pixelSize: pixelSize, policy: policy) }
            return image
        }
        requests[key] = task
        return task
    }

    func hue(_ url: URL?) async -> ArtworkHue? {
        guard let image = await image(url, pixelSize: 160) else { return nil }
        return await Task.detached(priority: .utility) { ArtworkDecoder.hue(image) }.value
    }

    private func key(_ url: URL, _ pixels: Int) -> String {
        "\(ArtworkSource.identity(url)):\(pixels)"
    }
}

private final class DecodedArtwork: NSObject {
    let image: UIImage
    let expiresAt: Date

    init(image: UIImage, expiresAt: Date) {
        self.image = image
        self.expiresAt = expiresAt
    }
}

enum ArtworkSource {
    static func identity(_ url: URL) -> String {
        let source: String
        if url.host == "assets.podcst.app", let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "p" })?.value,
           let original = URL(string: value), ["http", "https"].contains(original.scheme) {
            source = original.absoluteString
        } else {
            source = url.absoluteString
        }
        return SHA256.hash(data: Data(source.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func requestURL(_ url: URL, pixelSize: Int) -> URL {
        guard url.host == "assets.podcst.app", var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.contains(where: { $0.name == "p" }) == true else { return url }
        let pixels = [160, 384, 1024].first { $0 >= pixelSize }
        components.percentEncodedQueryItems = (components.percentEncodedQueryItems ?? []).filter { $0.name != "w" }
        if let pixels { components.percentEncodedQueryItems?.append(URLQueryItem(name: "w", value: String(pixels))) }
        return components.url ?? url
    }
}

private struct ArtworkMetadata: Codable, Sendable {
    var expiresAt: Date
    var accessedAt: Date
    let requestURL: URL
    let requestedSize: Int
    let etag: String?
    let modified: String?
}

private struct ArtworkPayload: Sendable {
    let data: Data
    var metadata: ArtworkMetadata
    var expiresAt: Date { metadata.expiresAt }
    var capacity: Int { max(metadata.requestedSize, ArtworkDecoder.dimension(data) ?? 0) }
}

private final class ArtworkPayloadBox: NSObject {
    let payload: ArtworkPayload
    init(_ payload: ArtworkPayload) { self.payload = payload }
}

private actor ArtworkStorage {
    private let directory: URL
    private let session: URLSession
    private let now: @Sendable () -> Date
    private let budget: Int
    private var entries: [String: ArtworkMetadata] = [:]
    private var pinned: Set<String>?
    private var loaded = false
    private var active = true
    private var requests: [String: Task<ArtworkPayload?, Never>] = [:]
    private var activeTransfers = 0
    private var waiting: [CheckedContinuation<Bool, Never>] = []
    private let transient = NSCache<NSString, ArtworkPayloadBox>()

    init(root: URL, accountID: String?, session: URLSession, now: @escaping @Sendable () -> Date, budget: Int) {
        let scope = accountID.map { SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined() } ?? "guest"
        directory = root.appendingPathComponent(scope, isDirectory: true)
        self.session = session
        self.now = now
        self.budget = budget
        transient.totalCostLimit = 8 * 1024 * 1024
        transient.countLimit = 64
    }

    func invalidate() {
        active = false
        requests.values.forEach { $0.cancel() }
        requests.removeAll()
        waiting.forEach { $0.resume(returning: false) }
        waiting.removeAll()
        transient.removeAllObjects()
        entries.removeAll()
        try? FileManager.default.removeItem(at: directory)
    }

    func promote(_ url: URL, pixelSize: Int) async {
        _ = await load(url, pixelSize: pixelSize, policy: .disk, refreshing: false)
    }

    func retain(_ urls: Set<URL>) async {
        guard active else { return }
        restore()
        pinned = Set(urls.map(ArtworkSource.identity))
        trim()
        saveIndex()
        await prefetch(Array(urls), pixelSize: 1024)
    }

    func prefetch(_ urls: [URL], pixelSize: Int) async {
        await withTaskGroup(of: Void.self) { group in
            var iterator = urls.makeIterator()
            for _ in 0..<3 {
                guard let url = iterator.next() else { break }
                group.addTask { _ = await self.load(url, pixelSize: pixelSize, policy: .disk, refreshing: false) }
            }
            while await group.next() != nil {
                guard !Task.isCancelled, let url = iterator.next() else { continue }
                group.addTask { _ = await self.load(url, pixelSize: pixelSize, policy: .disk, refreshing: false) }
            }
        }
    }

    func load(_ url: URL, pixelSize: Int, policy: ArtworkPolicy, refreshing: Bool) async -> ArtworkPayload? {
        guard active, !Task.isCancelled, ["http", "https"].contains(url.scheme) else { return nil }
        restore()
        let key = ArtworkSource.identity(url)
        let cached = read(key)
        if let cached, cached.capacity >= pixelSize, !refreshing || cached.expiresAt > now() {
            if pinned?.contains(key) == true || policy == .disk || entries[key] != nil {
                persist(cached, key: key, replacing: false)
            }
            if cached.expiresAt <= now() {
                Task { _ = await self.load(url, pixelSize: pixelSize, policy: policy, refreshing: true) }
            }
            return cached
        }
        if let pending = requests[key] {
            guard let result = await pending.value, active, !Task.isCancelled else { return cached }
            if result.capacity >= pixelSize {
                if pinned?.contains(key) == true || policy == .disk { persist(result, key: key, replacing: false) }
                return result
            }
            return await load(url, pixelSize: pixelSize, policy: policy, refreshing: refreshing)
        }
        let refreshSource = cached.flatMap { $0.capacity >= pixelSize ? $0.metadata.requestURL : nil } ?? url
        let requestedSize = max(pixelSize, pinned?.contains(key) == true ? 1024 : 0, cached?.metadata.requestedSize == Int.max ? 0 : cached?.metadata.requestedSize ?? 0)
        let requestURL = ArtworkSource.requestURL(refreshSource, pixelSize: requestedSize)
        let isVariant = requestURL.host == "assets.podcst.app" && URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "w" }) == true
        let capacity = isVariant ? ([160, 384, 1024].first { $0 >= requestedSize } ?? Int.max) : Int.max
        var request = URLRequest(url: requestURL, cachePolicy: .reloadIgnoringLocalCacheData)
        if let cached, cached.metadata.requestURL == requestURL {
            if let etag = cached.metadata.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            if let modified = cached.metadata.modified { request.setValue(modified, forHTTPHeaderField: "If-Modified-Since") }
        }
        let session = session
        let task = Task { () -> ArtworkPayload? in
            guard await self.acquireTransfer() else { return nil }
            defer {
                self.releaseTransfer()
                self.requests[key] = nil
            }
            guard !Task.isCancelled else { return nil }
            guard let (data, response) = try? await session.data(for: request), !Task.isCancelled,
                  let http = response as? HTTPURLResponse else { return nil }
            return self.received(data, response: http, cached: cached, requestURL: requestURL, capacity: capacity, key: key, policy: policy)
        }
        requests[key] = task
        return await task.value ?? cached
    }

    private func acquireTransfer() async -> Bool {
        guard active else { return false }
        if activeTransfers < 3 {
            activeTransfers += 1
            return true
        }
        return await withCheckedContinuation { waiting.append($0) }
    }

    private func releaseTransfer() {
        if waiting.isEmpty { activeTransfers -= 1 }
        else { waiting.removeFirst().resume(returning: active) }
    }

    private func received(_ data: Data, response: HTTPURLResponse, cached: ArtworkPayload?, requestURL: URL, capacity: Int, key: String, policy: ArtworkPolicy) -> ArtworkPayload? {
        guard active else { return nil }
        let bytes: Data
        if response.statusCode == 304, let cached {
            bytes = cached.data
        } else {
            guard (200..<300).contains(response.statusCode), data.count <= 16 * 1024 * 1024,
                  ArtworkDecoder.dimension(data) != nil else { return nil }
            bytes = data
        }
        let control = response.value(forHTTPHeaderField: "Cache-Control") ?? ""
        let age = control.split(separator: ",").compactMap { token -> TimeInterval? in
            let pair = token.trimmingCharacters(in: .whitespaces).split(separator: "=", maxSplits: 1)
            return pair.count == 2 && pair[0].lowercased() == "max-age" ? TimeInterval(pair[1]) : nil
        }.first ?? 86_400
        let currentAge = TimeInterval(response.value(forHTTPHeaderField: "Age") ?? "") ?? 0
        let expires = now().addingTimeInterval(max(0, min(age - currentAge, 7 * 86_400)))
        let metadata = ArtworkMetadata(expiresAt: expires, accessedAt: now(), requestURL: requestURL,
                                       requestedSize: capacity,
                                       etag: response.value(forHTTPHeaderField: "ETag") ?? (response.statusCode == 304 ? cached?.metadata.etag : nil),
                                       modified: response.value(forHTTPHeaderField: "Last-Modified") ?? (response.statusCode == 304 ? cached?.metadata.modified : nil))
        let payload = ArtworkPayload(data: bytes, metadata: metadata)
        if policy == .disk || pinned?.contains(key) == true || entries[key] != nil {
            persist(payload, key: key, replacing: response.statusCode != 304)
        } else {
            transient.setObject(ArtworkPayloadBox(payload), forKey: key as NSString, cost: bytes.count)
        }
        return payload
    }

    private func read(_ key: String) -> ArtworkPayload? {
        if var entry = entries[key] {
            if let data = try? Data(contentsOf: file(key)), ArtworkDecoder.dimension(data) != nil {
                entry.accessedAt = now()
                entries[key] = entry
                return ArtworkPayload(data: data, metadata: entry)
            }
            entries[key] = nil
            try? FileManager.default.removeItem(at: file(key))
            saveIndex()
        }
        return transient.object(forKey: key as NSString)?.payload
    }

    private func persist(_ payload: ArtworkPayload, key: String, replacing: Bool) {
        guard active else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if replacing || !FileManager.default.fileExists(atPath: file(key).path) {
                try payload.data.write(to: file(key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
            entries[key] = payload.metadata
            transient.removeObject(forKey: key as NSString)
            trim()
            saveIndex()
        } catch { return }
    }

    private func restore() {
        guard !loaded else { return }
        loaded = true
        if let data = try? Data(contentsOf: directory.appendingPathComponent("index.json")),
           let saved = try? JSONDecoder().decode([String: ArtworkMetadata].self, from: data) {
            entries = saved
        }
    }

    private func trim() {
        guard let pinned else { return }
        let candidates = entries.filter { !pinned.contains($0.key) }.sorted { $0.value.accessedAt < $1.value.accessedAt }
        var sizes: [String: Int] = [:]
        for (key, _) in candidates {
            sizes[key] = (try? file(key).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        }
        var total = sizes.values.reduce(0, +)
        for (key, _) in candidates where total > budget {
            try? FileManager.default.removeItem(at: file(key))
            entries[key] = nil
            total -= sizes[key] ?? 0
        }
    }

    private func saveIndex() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: directory.appendingPathComponent("index.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var location = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? location.setResourceValues(values)
    }

    private func file(_ key: String) -> URL { directory.appendingPathComponent(key + ".image") }
}

private enum ArtworkDecoder {
    static func dimension(_ data: Data) -> Int? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 16 * 1024 * 1024 / height else { return nil }
        return max(width, height)
    }

    static func image(_ data: Data, pixelSize: Int) -> UIImage? {
        guard let longest = dimension(data),
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let target = min(longest, Int(ceil(Double(pixelSize) * Double(longest) / Double(min(width, height)))))
        let options = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true, kCGImageSourceThumbnailMaxPixelSize: target] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options).map { UIImage(cgImage: $0) }
    }

    static func hue(_ image: UIImage) -> ArtworkHue? {
        guard let cgImage = image.cgImage else { return nil }
        let side = 12
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { return nil }
        let count = CGFloat(side * side * 255)
        let channel = { (offset: Int) in CGFloat(stride(from: offset, to: pixels.count, by: 4).reduce(0) { $0 + Int(pixels[$1]) }) / count }
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 0
        UIColor(red: channel(0), green: channel(1), blue: channel(2), alpha: 1).getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        return ArtworkHue(hue: hue, saturation: min(1, saturation * 1.8))
    }
}

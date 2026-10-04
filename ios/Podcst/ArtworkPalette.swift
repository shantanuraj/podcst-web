import CoreGraphics

struct ArtworkTint: Hashable, Sendable {
    let light: UInt32
    let dark: UInt32
}

struct ArtworkPalette {
    struct Swatch: Equatable {
        let rgb: UInt32
        let population: Int

        var hsl: HSL { HSL(rgb) }
    }

    struct HSL: Equatable {
        let hue: Float
        let saturation: Float
        let lightness: Float

        init(_ rgb: UInt32) {
            let red = Float((rgb >> 16) & 0xFF) / 255
            let green = Float((rgb >> 8) & 0xFF) / 255
            let blue = Float(rgb & 0xFF) / 255
            let high = max(red, green, blue)
            let low = min(red, green, blue)
            let delta = high - low
            let lightness = (high + low) / 2
            var hue: Float = 0
            var saturation: Float = 0
            if high != low {
                hue = high == red ? ((green - blue) / delta).truncatingRemainder(dividingBy: 6)
                    : high == green ? (blue - red) / delta + 2
                    : (red - green) / delta + 4
                saturation = delta / (1 - abs(2 * lightness - 1))
            }
            hue = (hue * 60).truncatingRemainder(dividingBy: 360)
            if hue < 0 { hue += 360 }
            self.hue = min(360, max(0, hue))
            self.saturation = min(1, max(0, saturation))
            self.lightness = min(1, max(0, lightness))
        }

        var allowed: Bool {
            lightness > 0.05 && lightness < 0.95 && !(hue >= 10 && hue <= 37 && saturation <= 0.82)
        }
    }

    enum Target: CaseIterable {
        case lightVibrant
        case vibrant
        case darkVibrant
        case lightMuted
        case muted
        case darkMuted

        private var lightness: (min: Float, target: Float, max: Float) {
            switch self {
            case .lightVibrant, .lightMuted: (0.55, 0.74, 1)
            case .vibrant, .muted: (0.3, 0.5, 0.7)
            case .darkVibrant, .darkMuted: (0, 0.26, 0.45)
            }
        }

        private var saturation: (min: Float, target: Float, max: Float) {
            switch self {
            case .lightVibrant, .vibrant, .darkVibrant: (0.35, 1, 1)
            case .lightMuted, .muted, .darkMuted: (0, 0.3, 0.4)
            }
        }

        func accepts(_ hsl: HSL) -> Bool {
            (saturation.min...saturation.max).contains(hsl.saturation) && (lightness.min...lightness.max).contains(hsl.lightness)
        }

        func score(_ swatch: Swatch, dominant: Int) -> Float {
            let hsl = swatch.hsl
            return 0.24 * (1 - abs(hsl.saturation - saturation.target))
                + 0.52 * (1 - abs(hsl.lightness - lightness.target))
                + 0.24 * Float(swatch.population) / Float(dominant)
        }
    }

    let swatches: [Swatch]
    let dominant: Swatch?
    private let selected: [Target: Swatch]

    init(swatches: [Swatch]) {
        self.swatches = swatches
        let dominant = swatches.max { $0.population < $1.population }
        var used = Set<UInt32>()
        var selected: [Target: Swatch] = [:]
        for target in Target.allCases {
            let best = swatches
                .filter { target.accepts($0.hsl) && !used.contains($0.rgb) }
                .max { target.score($0, dominant: dominant?.population ?? 1) < target.score($1, dominant: dominant?.population ?? 1) }
            if let best {
                selected[target] = best
                used.insert(best.rgb)
            }
        }
        self.dominant = dominant
        self.selected = selected
    }

    init(_ image: CGImage) {
        self.init(swatches: Self.quantize(Self.pixels(image)))
    }

    subscript(target: Target) -> Swatch? { selected[target] }

    var tint: ArtworkTint? {
        guard let dominant else { return nil }
        let light = self[.lightMuted] ?? self[.lightVibrant] ?? dominant
        let dark = self[.darkMuted] ?? self[.darkVibrant] ?? dominant
        return ArtworkTint(light: light.rgb, dark: dark.rgb)
    }

    private static func pixels(_ image: CGImage) -> [UInt32] {
        let area = Double(image.width * image.height)
        let ratio = area > 112 * 112 ? (112 * 112 / area).squareRoot() : 1
        let width = Int(ceil(Double(image.width) * ratio))
        let height = Int(ceil(Double(image.height) * ratio))
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return [] }
        return stride(from: 0, to: bytes.count, by: 4).map { UInt32(bytes[$0]) << 16 | UInt32(bytes[$0 + 1]) << 8 | UInt32(bytes[$0 + 2]) }
    }

    static func quantize(_ pixels: [UInt32], maxColors: Int = 16) -> [Swatch] {
        var histogram = [Int](repeating: 0, count: 1 << 15)
        for pixel in pixels {
            histogram[Int((pixel >> 19 & 0x1F) << 10 | (pixel >> 11 & 0x1F) << 5 | (pixel >> 3 & 0x1F))] += 1
        }
        var colors = histogram.indices.filter { histogram[$0] > 0 && HSL(widen($0)).allowed }
        guard colors.count > maxColors else {
            return colors.map { Swatch(rgb: widen($0), population: histogram[$0]) }
        }
        var boxes = [Box(colors.indices, colors: colors, histogram: histogram)]
        while boxes.count < maxColors,
              let index = boxes.indices.max(by: { boxes[$0].volume < boxes[$1].volume }),
              boxes[index].range.count > 1 {
            let box = boxes[index]
            let channel = box.longestChannel
            colors[box.range].sort { Box.key($0, major: channel) < Box.key($1, major: channel) }
            var count = 0
            let split = box.range.first { offset in
                count += histogram[colors[offset]]
                return count >= box.population / 2
            }.map { min(box.range.upperBound - 2, $0) } ?? box.range.lowerBound
            boxes[index] = Box(box.range.lowerBound..<split + 1, colors: colors, histogram: histogram)
            boxes.append(Box(split + 1..<box.range.upperBound, colors: colors, histogram: histogram))
        }
        return boxes.map { $0.average(colors: colors, histogram: histogram) }.filter { HSL($0.rgb).allowed }
    }

    private static func channel(_ color: Int, _ index: Int) -> Int {
        color >> (10 - 5 * index) & 0x1F
    }

    private static func widen(_ color: Int) -> UInt32 {
        widen(channel(color, 0), channel(color, 1), channel(color, 2))
    }

    private static func widen(_ red: Int, _ green: Int, _ blue: Int) -> UInt32 {
        UInt32(red << 3) << 16 | UInt32(green << 3) << 8 | UInt32(blue << 3)
    }

    private struct Box {
        let range: Range<Int>
        let population: Int
        let low: [Int]
        let high: [Int]

        init(_ range: Range<Int>, colors: [Int], histogram: [Int]) {
            self.range = range
            let members = colors[range]
            population = members.reduce(0) { $0 + histogram[$1] }
            low = (0..<3).map { index in members.map { ArtworkPalette.channel($0, index) }.min() ?? 0 }
            high = (0..<3).map { index in members.map { ArtworkPalette.channel($0, index) }.max() ?? 0 }
        }

        var volume: Int { (0..<3).reduce(1) { $0 * (high[$1] - low[$1] + 1) } }

        var longestChannel: Int {
            let lengths = (0..<3).map { high[$0] - low[$0] }
            if lengths[0] >= lengths[1], lengths[0] >= lengths[2] { return 0 }
            return lengths[1] >= lengths[0] && lengths[1] >= lengths[2] ? 1 : 2
        }

        static func key(_ color: Int, major: Int) -> Int {
            let order = [[0, 1, 2], [1, 0, 2], [2, 1, 0]][major]
            return order.reduce(0) { $0 << 5 | ArtworkPalette.channel(color, $1) }
        }

        func average(colors: [Int], histogram: [Int]) -> Swatch {
            let sums = (0..<3).map { index in colors[range].reduce(0) { $0 + histogram[$1] * ArtworkPalette.channel($1, index) } }
            let means = sums.map { Int((Float($0) / Float(population) + 0.5).rounded(.down)) }
            return Swatch(rgb: ArtworkPalette.widen(means[0], means[1], means[2]), population: population)
        }
    }
}

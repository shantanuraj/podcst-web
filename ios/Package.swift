// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Podcst",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "Podcst",
            targets: ["Podcst"]
        ),
    ],
    targets: [
        .target(
            name: "Podcst",
            path: "Podcst"
        ),
        .testTarget(
            name: "PodcstTests",
            dependencies: ["Podcst"],
            path: "PodcstTests"
        ),
    ]
)

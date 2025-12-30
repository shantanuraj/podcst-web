# Podcst iOS

Native iOS podcast player built with SwiftUI and SwiftData.

## Requirements

- iOS 17.0+
- Xcode 15.0+
- Swift 5.9+

## Project Setup

### Option 1: Create Xcode Project (Recommended)

1. Open Xcode
2. File → New → Project
3. Select "App" under iOS
4. Configure:
   - Product Name: `Podcst`
   - Team: Your team
   - Organization Identifier: `com.yourname`
   - Interface: SwiftUI
   - Language: Swift
   - Storage: SwiftData
5. Save in the `ios/` directory
6. Delete the auto-generated files and drag the `Podcst/` folder into the project

### Option 2: Use Swift Package Manager

```bash
cd ios
swift build
```

Note: SPM is primarily for building the library. For running on device, use Xcode.

## Project Structure

```
ios/Podcst/
├── App/                    # App entry point, root state
├── Domain/
│   ├── Models/            # Codable API models
│   └── Services/          # API, Audio, Download services
├── Data/                  # SwiftData schema, endpoints, config
├── Features/              # Feature modules (views + state)
│   ├── Auth/
│   ├── Discover/
│   ├── Library/
│   ├── Player/
│   ├── Podcast/
│   └── Settings/
└── Shared/               # Reusable components, extensions
```

## Architecture

- **@Observable**: iOS 17 observation macro for reactive state
- **SwiftData**: Persistence for offline cache and downloads
- **NavigationStack**: Type-safe navigation with `Destination` enum
- **Environment**: Dependency injection via SwiftUI environment

## Features

- [x] Top podcasts discovery
- [x] Podcast search
- [x] Podcast detail with paginated episodes
- [x] Background audio playback
- [x] Lock screen controls (MPNowPlayingInfoCenter)
- [x] Remote command center
- [x] Playback progress sync
- [x] Email code authentication
- [x] Subscriptions sync
- [x] Episode downloads for offline playback
- [ ] Passkey authentication
- [ ] CarPlay support
- [ ] Widgets

## Configuration

Edit `Data/Configuration.swift` to change the API base URL:

```swift
enum Configuration {
    static let apiBaseURL: URL = {
        #if DEBUG
        URL(string: "http://localhost:3000")!
        #else
        URL(string: "https://podcst.fly.dev")!
        #endif
    }()
}
```

## Info.plist Requirements

Add these keys for background audio:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>fetch</string>
</array>
```

## Running

1. Open the Xcode project
2. Select your target device/simulator
3. Press ⌘R to build and run

For development with local API:
1. Run the web app: `cd .. && bun dev`
2. The iOS app will connect to `localhost:3000` in debug builds

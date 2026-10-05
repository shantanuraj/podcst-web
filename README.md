# [Podcst](https://podcst.app)

Podcst is a podcast player for the web, iOS and Android.

The aim is to provide an excellent listening experience across desktop, tablets
and mobile, with a focus on accessibility and keyboard navigation.

## Features

- Podcast search and regional charts
- Passkey sign-in
- Cross-device subscription and playback sync
- Private RSS feeds and OPML import/export
- Queue, chapters and playback speed controls
- Chromecast and AirPlay support
- Offline downloads, Volume Boost and Trim Silence in the native apps

[Listen on the web](https://podcst.app). The native apps are being prepared for
their first public release. The web app targets evergreen browsers.

## Development

The web app uses Next.js, React and TypeScript, with PostgreSQL and Redis.
The iOS app uses SwiftUI; Android uses Kotlin and Compose. Both native apps share
a Rust audio engine.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build and test instructions.
[Technical references](docs/README.md) cover the API, playback and database tools.

## Contributing

Bug reports and pull requests are welcome. For larger changes, open an issue
first so we can discuss the approach.

Thanks to everyone who has [contributed](https://github.com/shantanuraj/podcst-web/graphs/contributors).

## License

[MIT](LICENSE.md)

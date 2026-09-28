# [podcst-web](https://podcst.app)

[![code style: biome](https://img.shields.io/badge/code_style-biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev/)

Podcst Web is a modern PWA to listen to podcasts.

The aim of this project is to provide an excellent podcast listening experience on all types of devices (desktop, tablets, mobile).

Another major focus is on accessibility, with full keyboard navigation support.

> **Note:** This project only aims to support ever-green browsers.

## Features

- User accounts with passkey authentication
- Cross-device subscription and playback sync
- Podcast search and discovery
- Top podcasts by region
- Chromecast and AirPlay support
- Private feed support
- Media session integration
- Offline PWA capabilities

## Architecture

- **Frontend**: Next.js with App Router, React 19, TypeScript
- **State Management**: Zustand for client state
- **Data Fetching**: TanStack Query
- **Database**: PostgreSQL (content + user data)
- **Caching**: Redis + IndexedDB + LocalStorage
- **Audio**: Howler.js
- **Styling**: Tailwind CSS 4 + CSS Modules
- **Code Quality**: Biome for formatting and linting

### Data Flow

```
Background Jobs (cron):
├── poll-top-charts.ts  → iTunes API → top_podcasts table
├── poll-feeds.ts       → RSS feeds → episodes table
└── sync-podcast-index  → Podcast Index dump → podcasts table

API Routes (database-first):
├── /api/top           → PostgreSQL → top podcasts
├── /api/feed          → PostgreSQL → podcast + episodes
└── /api/search        → PostgreSQL + iTunes fallback
```

### Branching Model

Simple branch-and-merge workflow:

- `main` is the production branch
- Branch off `main` for new features or fixes
- Open a PR and merge back to `main` when ready

## Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime (for scripts)
- [Node](https://nodejs.org/) - LTS version
- [yarn](https://yarnpkg.com/) - package manager
- [PostgreSQL](https://www.postgresql.org/) - database
- [Redis](https://redis.io/) - caching layer

## Getting Started

Clone this repository and install dependencies:

```bash
git clone https://github.com/shantanuraj/podcst-web
cd podcst-web
yarn
```

Set up environment variables (create `.env.local`):

```bash
# Vercel-style connection URLs are supported.
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Non-Vercel hosts can use host-based settings instead.
PG_HOST=/var/run/postgresql
PG_USER=podcst_app
PG_DATABASE=podcst
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=...

WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3000
RESEND_API_KEY=...  # optional, for email verification
```

For production, use `WEBAUTHN_RP_ID=podcst.app` and
`WEBAUTHN_RP_ORIGIN=https://www.podcst.app`. The native iOS client uses the
same relying-party ID through the `webcredentials:podcst.app` associated
domain.

Run database migrations:

```bash
yarn db:migrate
```

Start the development server:

```bash
yarn dev
```

## Development

### Available Scripts

```bash
yarn dev                 # Start development server
yarn build               # Build for production
yarn start               # Start production server
yarn format              # Format code with Biome
yarn lint                # Lint code with Biome
yarn db:migrate          # Run database migrations
```

### Tests

```bash
yarn test
TEST_DATABASE_URL=postgres://localhost/podcst_test yarn test
```

PostgreSQL refresh integration tests run when `TEST_DATABASE_URL` is set. They
create and remove an isolated schema; the database user needs schema-creation
privileges. Use a local test database, not production.

### Background Jobs

These scripts run as background jobs to keep content fresh:

```bash
bun scripts/poll-top-charts.ts     # Sync iTunes top charts + poll missing episodes
bun scripts/poll-feeds.ts          # Poll RSS feeds (single batch)
bun scripts/poll-feeds.ts --daemon # Poll RSS feeds continuously
bun scripts/sync-podcast-index.ts  # Sync from Podcast Index database dump
```

Subscribed feeds and feeds played in the last 90 days are polled hourly. Other
eligible feeds use `podcasts.update_frequency` in seconds, defaulting to one day.
Opening a feed checks for updates in the background if its last check was at
least 15 minutes ago. All refresh paths share database locking and failure
backoff.

Feed-refresh changes require both a web deployment and a restart of
`podcst-poller.service` after updating its checkout.

Chart imports replace each country atomically, continue after individual country
failures, and record stored/new/failed counts in `poll_metrics`. Apple IDs use
`BIGINT`; existing installations must apply `0009-itunes-id-bigint.sql` before
running the updated importers. This migration rewrites the podcasts table and
its indexes, so schedule a maintenance window and stop the feed poller first.

On the host install the chart service and six-hour timer:

```bash
sudo install -m 644 scripts/podcst-charts.service scripts/podcst-charts.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podcst-charts.timer
sudo systemctl start podcst-charts.service
sudo journalctl -u podcst-charts.service
```

Remove the old `poll-top-job.sh` crontab entry when enabling this timer to avoid
duplicate runs. Job output and failures are retained in the system journal.

### Building for Production

```bash
yarn build
```

This creates an optimized production build in the `.next` folder.

### iOS Client

The native client is in `ios/Podcst.xcodeproj` and targets iOS 18 or later. Install
Xcode and Rust through rustup, then add the Apple targets. The Xcode build phase
compiles the native audio library for the selected destination; build artifacts
stay in Derived Data.

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
xcodebuild -project ios/Podcst.xcodeproj -scheme Podcst -sdk iphonesimulator build
xcodebuild -project ios/Podcst.xcodeproj -scheme PodcstTests -destination 'platform=iOS Simulator,name=iPhone 16' test
```

#### Install a Release build on your iPhone

If needed, select your team under **Podcst → Signing & Capabilities**, or set
`DEVELOPMENT_TEAM` when running the script. The app's Associated Domains
capability requires a team that supports it.

```bash
xcrun devicectl list devices
yarn ios:install <device-udid>
```

Use the physical phone's UDID. You can also run
`./ios/scripts/install-device.sh <device-udid>` directly, or save
`IOS_DEVICE_ID` in your shell environment and run `yarn ios:install`.

The script always builds the **Release** configuration for the phone, including
the release-mode audio engine, then installs and launches it without a
debugger. Builds are cached in `ios/build/device/`.

This replaces the existing Podcst app with the same bundle ID; Audio Lab is
unaffected.

The client uses the web API for discovery, feed indexing, subscriptions,
authentication and playback progress. An HTTP(S) feed URL entered in Discover
is indexed through `/api/feed`, including private feeds whose access token is
part of the URL.

Development of Volume Boost, Trim Silence, and native audio playback follows the [two-milestone audio experience plan](docs/audio-experience-plan.md).

Choose the **Podcst Audio Lab** scheme to run the development player. It builds
**Audio Lab**, a separate app (`app.podcst.ios.audiolab`) that installs beside
Podcst. Open a local audio file to exercise the native backend, speed, seeking
and lock-screen controls. The lab uses a separate temporary playback state and
does not sync progress to the server. Normal podcast playback still uses AVPlayer. See the
[local audio harness instructions](audio-engine/README.md#local-ios-audio-lab)
for its current timing policy and validation limits.

## Deployment

The app is deployed on both Vercel and Fly.io, with plans to consolidate on Fly.io.

### Vercel

Automatic deployment on every push to `main`.

### Fly.io

Deploy using the Fly CLI.

```bash
./scripts/deploy-fly.sh
```

### Updating image proxy

The image proxy is deployed separately from the web application. Operators can
update an existing, preconfigured Linux/systemd installation with:

```bash
bun run deploy:img-proxy
```

Run on the service host. The updater fetches `origin/main` from the sibling
`img_proxy` checkout.

```bash
# Validate dependencies and tests without changing the installed service:
./scripts/deploy-img-proxy.sh --check
# Use a different source checkout:
./scripts/deploy-img-proxy.sh --repo /path/to/img_proxy
```

## Built With

- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Next.js](https://nextjs.org/) - React framework
- [React](https://react.dev/) - UI library
- [TanStack Query](https://tanstack.com/query) - Data fetching and caching
- [Zustand](https://zustand-demo.pmnd.rs/) - State management
- [Howler](https://howlerjs.com/) - Audio playback
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS
- [PostgreSQL](https://www.postgresql.org/) - Database
- [Redis](https://redis.io/) - Caching
- [Biome](https://biomejs.dev/) - Linting and formatting

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for process details on collaborating on this project.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For available versions of this software, see the [releases on this repository](https://github.com/shantanuraj/podcst-web/releases).

## Authors

See the list of [contributors][Contributor List] who participated in this project.

[Contributor List]: https://github.com/shantanuraj/podcst-web/contributors

## License

This project is licensed under the MIT License - see the
[LICENSE](LICENSE.md) file for details.

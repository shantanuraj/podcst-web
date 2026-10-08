# Contributing

For larger changes, open an issue before starting work. Keep pull requests focused,
include tests for changed behaviour, and update the relevant docs rather than
adding implementation notes to the README. Get a review before merging.

## Web setup

Install Node.js (LTS), Yarn 1.x, [Bun](https://bun.sh/), PostgreSQL 16 or newer,
and Redis. Start PostgreSQL and Redis locally, then:

```sh
git clone https://github.com/shantanuraj/podcst-web.git
cd podcst-web
yarn install
createdb podcst_dev
```

Create `.env.local` with your local connection settings:

```dotenv
DATABASE_URL=postgresql://localhost/podcst_dev
MIGRATION_DATABASE_URL=postgresql://localhost/podcst_dev
REDIS_URL=redis://localhost:6379
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3000
```

Set `RESEND_API_KEY` if you want to test email verification. Never use production
credentials or data for local development.

Initialize the empty database and start the app:

```sh
yarn db:migrate status
yarn db:migrate up
yarn dev
```

Open <http://localhost:3000>. The initial catalogue is empty; text search uses
Apple's public API. See [database migrations](docs/database-migrations.md) before
upgrading an existing database. `yarn db:migrate` alone only reports status.

## Checks

```sh
yarn test
yarn lint
yarn tsc --noEmit
yarn build
```

With Docker running, test the production image and its public HTML against
throwaway PostgreSQL and Redis instances:

```sh
docker build -t podcst-local .
scripts/test-container.sh podcst-local
```

The image build needs no database credentials. The smoke test uses synthetic data
and removes its containers afterwards.

Use `yarn format` to format web source with Biome. To run one test file:

```sh
bun test src/app/api/feed/parser.test.ts
```

Database and Redis integration tests need disposable services:

```sh
createdb podcst_test
TEST_DATABASE_URL=postgresql://localhost/podcst_test \
  TEST_REDIS_URL=redis://localhost:6379/1 yarn test
```

Database tests create isolated schemas; the test role needs permission to create
schemas. Use a dedicated Redis instance or database with no valuable data.
Migration and repair tests start their own PostgreSQL clusters when `PG_BIN`
points to the directory containing `initdb` and `pg_ctl`. Missing integration
prerequisites cause skips, not passing coverage. The list limiter suite starts its
own loopback-only Redis with persistence disabled; it needs `redis-server` on
`PATH`, not just `TEST_REDIS_URL`. CI installs the binary and sets
`REQUIRE_LIST_LIMIT_TESTS=1` so its absence fails instead of silently skipping:

```sh
REQUIRE_LIST_LIMIT_TESTS=1 bun --no-env-file test src/server/lists/limits.integration.test.ts
```

## iOS

Requires macOS, Xcode with an iOS SDK, Rust through rustup, and FFmpeg for test
fixtures. The app targets iOS 18 or later.

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
xcodebuild -project ios/Podcst.xcodeproj -scheme Podcst -sdk iphonesimulator build
xcodebuild -project ios/Podcst.xcodeproj -scheme PodcstTests \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

Use an available simulator name on your machine. Xcode builds the Rust library
for the selected destination automatically.

For a physical device, select your own signing team in Xcode. Associated Domains
requires a team that supports the capability.

```sh
xcrun devicectl list devices
yarn ios:install <device-udid>
```

This installs a Release build. Add `--audio-lab` to install the separate
[Audio Lab](audio-engine/README.md#local-ios-audio-lab) app instead.

## Android

Requires JDK 17, the Android SDK, and Rust through rustup. SDK/NDK/CMake versions
are pinned in [`android/core/audio-engine/build.gradle.kts`](android/core/audio-engine/build.gradle.kts)
and the [CI workflow](.github/workflows/android.yml). Set `ANDROID_HOME` to your
SDK installation. The app targets Android 13 or later.

```sh
rustup target add --toolchain stable aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cd android
./gradlew :app:assembleDebug
./gradlew :core:model:test :core:network:test testDebugUnitTest
./gradlew :core:audio-engine:connectedDebugAndroidTest :core:playback:connectedDebugAndroidTest
```

Connected tests need a device or emulator. Gradle builds the shared Rust engine.
Release builds are unsigned unless you configure your own signing key using
`podcst.release.storeFile`, `podcst.release.storePassword`,
`podcst.release.keyAlias` and `podcst.release.keyPassword` in your user-level
Gradle properties. Keep keystores and passwords outside the repository.

From the repository root, `yarn android:install <device-serial>` builds and
installs a signed Release build on a connected device.

Both native clients default to the hosted API. For backend work, configure their
`APIClient` (iOS) or `PodcstApi` (Android) with your development server. Passkeys on
your own domain also require matching app identities and association files; see
[`native-apps.ts`](src/server/auth/native-apps.ts).

## Shared code and documentation

- [`src/`](src/): web UI, API routes and server code
- [`ios/`](ios/) and [`android/`](android/): native apps
- [`audio-engine/`](audio-engine/README.md): Rust DSP and local audio tools
- [`contracts/`](contracts/): shared API fixtures and playback test vectors
- [`docs/`](docs/README.md): technical references

When changing shared behaviour, update the contract and both clients' tests
in the same change. Simulator and unit tests do not replace
[device testing](docs/audio-device-validation.md).

Use synthetic accounts, feed URLs and media in tests. Do not commit credentials,
private feed links, production dumps, deployment receipts or local agent logs.
Review diagnostic output before attaching it to an issue.

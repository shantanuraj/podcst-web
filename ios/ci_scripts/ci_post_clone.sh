#!/bin/bash
set -euo pipefail

# Xcode Cloud starts without Rust. Install it where build-xcode.sh looks for it;
# PATH exports in this hook do not carry over to Xcode's build phases.
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --retry 3 \
    https://sh.rustup.rs | sh -s -- -y --profile minimal \
    --default-toolchain "${RUSTUP_TOOLCHAIN:-stable}" --no-modify-path

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
rustc --version
cargo --version

# Test targets generate audio fixtures; ordinary app builds and archives do not.
case "${CI_XCODEBUILD_ACTION:-}" in
    build-for-testing|test-without-building)
        export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
        command -v ffmpeg >/dev/null || brew install ffmpeg
        ;;
esac

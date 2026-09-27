#!/bin/bash
set -euo pipefail

engine_dir="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
for tool in cargo rustup xcrun; do
    command -v "$tool" >/dev/null || { echo "error: Missing $tool. Install Rust using rustup and select Xcode." >&2; exit 1; }
done
: "${PLATFORM_NAME:?Run this script from the Podcst Xcode build.}"
: "${ARCHS:?Missing Xcode architectures.}"
: "${DERIVED_FILE_DIR:?Missing Xcode derived files directory.}"
: "${BUILT_PRODUCTS_DIR:?Missing Xcode build products directory.}"

installed_targets="$(rustup target list --installed)"
libraries=()
for architecture in $ARCHS; do
    case "$PLATFORM_NAME:$architecture" in
        iphoneos:arm64) target=aarch64-apple-ios ;;
        iphonesimulator:arm64) target=aarch64-apple-ios-sim ;;
        iphonesimulator:x86_64) target=x86_64-apple-ios ;;
        *) echo "error: Unsupported native audio platform: $PLATFORM_NAME/$architecture" >&2; exit 1 ;;
    esac
    if ! [[ $'\n'"$installed_targets"$'\n' == *$'\n'"$target"$'\n'* ]]; then
        echo "error: Install the Rust target with: rustup target add $target" >&2
        exit 1
    fi
    cargo build --manifest-path "$engine_dir/Cargo.toml" --locked --lib --release \
        --target "$target" --target-dir "$DERIVED_FILE_DIR/native-audio"
    libraries+=("$DERIVED_FILE_DIR/native-audio/$target/release/libpodcst_audio_engine.a")
done

mkdir -p "$BUILT_PRODUCTS_DIR"
xcrun lipo -create "${libraries[@]}" -output "$BUILT_PRODUCTS_DIR/libpodcst_audio_engine.a"

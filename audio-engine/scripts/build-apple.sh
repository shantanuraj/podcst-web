#!/bin/bash
set -euo pipefail

engine_dir="$(cd "$(dirname "$0")/.." && pwd)"
for tool in cargo rustup xcrun xcodebuild; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

targets=(aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios)
installed_targets="$(rustup target list --installed)"
for target in "${targets[@]}"; do
    if ! [[ $'\n'"$installed_targets"$'\n' == *$'\n'"$target"$'\n'* ]]; then
        echo "Missing Rust target. Run: rustup target add $target" >&2
        exit 1
    fi
done

export IPHONEOS_DEPLOYMENT_TARGET=18.0
for target in "${targets[@]}"; do
    cargo build --manifest-path "$engine_dir/Cargo.toml" --locked --lib --release \
        --target "$target" --target-dir "$engine_dir/target"
done

output_dir="$engine_dir/target/apple"
mkdir -p "$output_dir"
staging_dir="$(mktemp -d "$output_dir/.package.XXXXXX")"
trap 'rm -rf "$staging_dir"' EXIT

mkdir -p "$staging_dir/simulator"
xcrun lipo -create \
    "$engine_dir/target/aarch64-apple-ios-sim/release/libpodcst_audio_engine.a" \
    "$engine_dir/target/x86_64-apple-ios/release/libpodcst_audio_engine.a" \
    -output "$staging_dir/simulator/libpodcst_audio_engine.a"

xcodebuild -create-xcframework \
    -library "$engine_dir/target/aarch64-apple-ios/release/libpodcst_audio_engine.a" \
    -headers "$engine_dir/include" \
    -library "$staging_dir/simulator/libpodcst_audio_engine.a" \
    -headers "$engine_dir/include" \
    -output "$staging_dir/PodcstAudioEngine.xcframework"

rm -rf "$output_dir/PodcstAudioEngine.xcframework"
mv "$staging_dir/PodcstAudioEngine.xcframework" "$output_dir/PodcstAudioEngine.xcframework"
echo "$output_dir/PodcstAudioEngine.xcframework"

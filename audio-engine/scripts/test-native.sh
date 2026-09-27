#!/bin/bash
set -euo pipefail

if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--apple") ]]; then
    echo "Usage: $0 [--apple]" >&2
    exit 1
fi

engine_dir="$(cd "$(dirname "$0")/.." && pwd)"
for tool in cargo xcrun; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
cargo build --manifest-path "$engine_dir/Cargo.toml" --locked --lib --target-dir "$engine_dir/target"

build_dir="$engine_dir/target/native-tests"
mkdir -p "$build_dir"
link_flags=(-liconv -framework Security -framework CoreFoundation)
xcrun clang -std=c11 -Wall -Wextra -Werror \
    -I "$engine_dir/include" "$engine_dir/tests/native_smoke.c" \
    "$engine_dir/target/debug/libpodcst_audio_engine.a" "${link_flags[@]}" \
    -o "$build_dir/c-smoke"
"$build_dir/c-smoke"

xcrun swiftc -swift-version 6 -warnings-as-errors \
    -I "$engine_dir/include" -L "$engine_dir/target/debug" \
    "$engine_dir/tests/native_smoke.swift" -lpodcst_audio_engine "${link_flags[@]}" \
    -o "$build_dir/swift-smoke"
"$build_dir/swift-smoke"

if [[ ${1:-} == "--apple" ]]; then
    framework="$engine_dir/target/apple/PodcstAudioEngine.xcframework"
    [[ -d "$framework" ]] || { echo "Run scripts/build-apple.sh first." >&2; exit 1; }
    for variant in device simulator-arm64 simulator-x86_64; do
        case "$variant" in
            device)
                sdk=iphoneos
                target=arm64-apple-ios18.0
                slice=ios-arm64
                ;;
            simulator-arm64)
                sdk=iphonesimulator
                target=arm64-apple-ios18.0-simulator
                slice=ios-arm64_x86_64-simulator
                ;;
            simulator-x86_64)
                sdk=iphonesimulator
                target=x86_64-apple-ios18.0-simulator
                slice=ios-arm64_x86_64-simulator
                ;;
        esac
        sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
        xcrun --sdk "$sdk" swiftc -swift-version 6 -warnings-as-errors -target "$target" -sdk "$sdk_path" \
            -I "$framework/$slice/Headers" -L "$framework/$slice" \
            "$engine_dir/tests/native_smoke.swift" -lpodcst_audio_engine "${link_flags[@]}" \
            -o "$build_dir/swift-$variant"
    done
fi

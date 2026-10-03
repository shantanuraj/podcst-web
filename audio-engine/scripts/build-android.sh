#!/bin/bash
set -euo pipefail

engine_dir="$(cd "$(dirname "$0")/.." && pwd)"
target_dir="$engine_dir/target"
if [[ ${1:-} == "--target-dir" ]]; then
    [[ $# -ge 2 ]] || { echo "Usage: $0 [--target-dir <dir>] [abi...]" >&2; exit 1; }
    target_dir="$2"
    shift 2
fi
abis=("$@")
[[ ${#abis[@]} -gt 0 ]] || abis=(arm64-v8a armeabi-v7a x86_64)

for tool in cargo rustup; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

triple() {
    case "$1" in
        arm64-v8a) echo aarch64-linux-android ;;
        armeabi-v7a) echo armv7-linux-androideabi ;;
        x86_64) echo x86_64-linux-android ;;
        *) echo "Unsupported Android ABI: $1" >&2; exit 1 ;;
    esac
}

installed_targets="$(rustup target list --installed)"
for abi in "${abis[@]}"; do
    target="$(triple "$abi")"
    if ! [[ $'\n'"$installed_targets"$'\n' == *$'\n'"$target"$'\n'* ]]; then
        echo "Missing Rust target for $abi. Run: rustup target add $target" >&2
        exit 1
    fi
done

for abi in "${abis[@]}"; do
    target="$(triple "$abi")"
    cargo build --manifest-path "$engine_dir/Cargo.toml" --locked --lib --release \
        --target "$target" --target-dir "$target_dir"
    mkdir -p "$target_dir/android/$abi"
    cp -p "$target_dir/$target/release/libpodcst_audio_engine.a" "$target_dir/android/$abi/libpodcst_audio_engine.a"
    echo "$target_dir/android/$abi/libpodcst_audio_engine.a"
done

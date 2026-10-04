#!/bin/bash
set -euo pipefail

usage() {
    printf '%s\n' \
        'Usage: yarn android:install [device-serial]' \
        'Build, install, and launch Podcst using the Release build type.' \
        '' \
        'Without a serial, the first ready device from adb devices is used.' \
        'Use ANDROID_SERIAL to save the serial; an argument takes precedence.' \
        'Find the serial with: adb devices'
}

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
    usage
    exit 0
fi

if [[ $# -gt 1 || ${1:-} == -* ]]; then
    usage >&2
    exit 1
fi

device="${1:-${ANDROID_SERIAL:-}}"
if [[ -z "$device" ]]; then
    device="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
fi
if [[ -z "$device" ]]; then
    printf 'No ready device. Connect a phone or start an emulator, then check adb devices.\n' >&2
    exit 1
fi

android_dir="$(cd "$(dirname "$0")/.." && pwd)"
apk="$android_dir/app/build/outputs/apk/release/app-release.apk"
component=app.podcst.android/app.podcst.MainActivity

printf 'Building Podcst (Release) for %s…\n' "$device"
"$android_dir/gradlew" -p "$android_dir" --console=plain -q :app:assembleRelease

printf 'Installing %s…\n' "$apk"
adb -s "$device" install -r "$apk"

printf 'Launching %s…\n' "$component"
adb -s "$device" shell am start -S -n "$component"

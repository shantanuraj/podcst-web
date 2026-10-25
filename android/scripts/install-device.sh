#!/bin/bash
set -euo pipefail

usage() {
    printf '%s\n' \
        'Usage: yarn android:install [device-serial]' \
        'Build, install, and launch Podcst using the Release build type.' \
        '' \
        'Requires Android CLI (android) on PATH.' \
        'Without a serial, Android CLI selects the device.' \
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
set --
if [[ -n "$device" ]]; then
    set -- "--device=$device"
fi

android_dir="$(cd "$(dirname "$0")/.." && pwd)"
exec android run "$android_dir?:app@release" "$@" -- --console=plain -q

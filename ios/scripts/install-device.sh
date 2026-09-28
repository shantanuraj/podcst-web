#!/bin/bash
set -euo pipefail

usage() {
    printf '%s\n' \
        'Usage: yarn ios:install <device-udid>' \
        'Build, install, and launch Podcst using the Release configuration.' \
        '' \
        'Use IOS_DEVICE_ID to save the UDID; an argument takes precedence.' \
        'Use DEVELOPMENT_TEAM to override the signing team in Xcode.' \
        'Find the UDID with: xcrun devicectl list devices'
}

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
    usage
    exit 0
fi

device="${1:-${IOS_DEVICE_ID:-}}"
if [[ $# -gt 1 || -z "$device" || "$device" == -* ]]; then
    usage >&2
    exit 1
fi

ios_dir="$(cd "$(dirname "$0")/.." && pwd)"
scheme=Podcst
configuration=Release
derived_data="$ios_dir/build/device"

build=(
    xcrun xcodebuild
    -project "$ios_dir/$scheme.xcodeproj"
    -scheme "$scheme"
    -configuration "$configuration"
    -sdk iphoneos
    -destination "platform=iOS,id=$device"
    -derivedDataPath "$derived_data"
    -allowProvisioningUpdates
    -allowProvisioningDeviceRegistration
    -quiet
)
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
    build+=("DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM")
fi

printf 'Building %s (%s) for %s…\n' "$scheme" "$configuration" "$device"
"${build[@]}" build

app="$derived_data/Build/Products/$configuration-iphoneos/$scheme.app"
bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$app/Info.plist")"

printf 'Installing %s…\n' "$app"
xcrun devicectl device install app --device "$device" "$app"

printf 'Launching %s… Unlock your phone if prompted.\n' "$bundle_id"
xcrun devicectl device process launch --device "$device" --terminate-existing "$bundle_id"

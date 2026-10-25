#!/bin/bash
set -euo pipefail
umask 077

usage() {
    printf '%s\n' \
        'Usage: yarn android:release <version-name> <version-code> <output-directory>' \
        '' \
        'Build and verify a signed Google Play AAB; never upload it.' \
        'The output directory must be new, with an existing parent outside Git.' \
        'Set ANDROID_UPLOAD_CERTIFICATE to your approved upload certificate PEM.' \
        'Configure podcst.release signing properties in ~/.gradle/gradle.properties.' \
        'See docs/native-distribution.md for setup and remaining release checks.'
}

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
    usage
    exit 0
fi
[[ $# -eq 3 ]] || { usage >&2; exit 1; }
[[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9.+_-]*$ ]] || fail 'Invalid version name.'
if [[ ! $2 =~ ^[1-9][0-9]{0,9}$ ]] || (( $2 > 2100000000 )); then
    fail 'Version code must be between 1 and 2100000000.'
fi
[[ -f ${ANDROID_UPLOAD_CERTIFICATE:-} ]] || fail 'Set ANDROID_UPLOAD_CERTIFICATE to your approved upload certificate PEM.'

for tool in git keytool jarsigner unzip shasum; do
    command -v "$tool" >/dev/null || fail "Required tool not found: $tool"
done

android_dir="$(cd "$(dirname "$0")/.." && pwd -P)"
root="$(cd "$android_dir/.." && pwd -P)"
[[ -z $(git -C "$root" status --porcelain) ]] || fail 'Commit or stash changes before building a release.'
revision="$(git -C "$root" rev-parse HEAD)"
parent="$(cd "$(dirname "$3")" && pwd -P)"
output="$parent/$(basename "$3")"
[[ ! -e $output && ! -L $output ]] || fail 'Output directory already exists; choose a new directory.'
if git -C "$parent" rev-parse --show-toplevel >/dev/null 2>&1; then
    fail 'Keep release artifacts outside Git checkouts.'
fi

mkdir "$output"
complete=false
cleanup() {
    rm -rf "$output/.verification"
    if [[ $complete != true ]]; then
        rm -rf "$output"
    fi
}
trap cleanup EXIT
work="$output/.verification"
mkdir "$work"
cp "$ANDROID_UPLOAD_CERTIFICATE" "$output/upload-certificate.pem"
keytool -printcert -file "$output/upload-certificate.pem" > "$output/upload-certificate.txt"
if grep -Eq '(^|[, ])CN=Android Debug([,]|$)' "$output/upload-certificate.txt"; then
    fail 'An Android debug certificate cannot be used for a Play release.'
fi
keytool -importcert -noprompt -alias upload -file "$output/upload-certificate.pem" \
    -keystore "$work/trusted-upload.p12" -storepass public-certificate-only

"$android_dir/gradlew" -p "$android_dir" --console=plain --no-daemon --no-configuration-cache \
    :app:bundleRelease -Ppodcst.release.requireSigning=true \
    "-Ppodcst.release.versionName=$1" "-Ppodcst.release.versionCode=$2"

outputs="$android_dir/app/build/outputs"
cp "$outputs/bundle/release/app-release.aab" "$output/app-release.aab"
[[ -s $outputs/mapping/release/mapping.txt ]] || fail 'Release mapping.txt is missing or empty.'
cp "$outputs/mapping/release/mapping.txt" "$output/mapping.txt"
jarsigner -verify -strict -keystore "$work/trusted-upload.p12" \
    -storepass public-certificate-only "$output/app-release.aab" upload \
    > "$output/signature.txt" 2>&1 || fail 'Bundle signature verification failed; check the configured upload key and certificate.'

unzip -Z1 "$output/app-release.aab" > "$work/entries.txt"
abis="$(awk -F/ '$1 == "base" && $2 == "lib" && NF == 4 && $4 ~ /\.so$/ { print $3 }' "$work/entries.txt" | sort -u)"
[[ -n $abis ]] || fail 'The bundle contains no native libraries.'
while IFS= read -r abi; do
    grep -Fxq "base/lib/$abi/libpodcst_audio_jni.so" "$work/entries.txt" || fail "Podcst JNI library missing for $abi."
    grep -Fxq "BUNDLE-METADATA/com.android.tools.build.debugsymbols/$abi/libpodcst_audio_jni.so.dbg" "$work/entries.txt" || fail "Podcst native debug symbols missing for $abi."
done <<< "$abis"
unzip -q "$output/app-release.aab" 'BUNDLE-METADATA/com.android.tools.build.debugsymbols/*' -d "$work"
mv "$work/BUNDLE-METADATA/com.android.tools.build.debugsymbols" "$output/native-debug-symbols"

[[ -z $(git -C "$root" status --porcelain) && $(git -C "$root" rev-parse HEAD) == "$revision" ]] || fail 'Source changed during the build; rebuild from a clean commit.'
printf 'commit=%s\nversionName=%s\nversionCode=%s\n' "$revision" "$1" "$2" > "$output/release.txt"
rm -rf "$work"
checksums="$(cd "$output" && find . -type f -exec shasum -a 256 {} + | LC_ALL=C sort)"
printf '%s\n' "$checksums" > "$output/SHA256SUMS"
complete=true
printf '\nSigned bundle: %s/app-release.aab\nSymbols, mapping and SHA256SUMS: %s\n' "$output" "$output"
printf 'No upload performed. Complete the Play internal-testing and release checks before public submission.\n'

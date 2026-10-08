# Native distribution

Local builds, signed artifacts, store-installed tests and public submission are
separate gates. This guide does not authorize credential access, uploads, backend
activation or submission. Keep signing material, store credentials, device IDs,
raw logs and release receipts outside Git. Use the
[acceptance worksheet](native-release-validation.md) for exact-artifact evidence.

## Freeze the candidate

- Start from a clean, pinned full commit and frozen dependencies. Record the API
  revision, migrations/protocol, Xcode/SDK, JDK/Gradle/AGP, Rust, NDK/CMake and lockfile
  hashes. Use the [setup instructions](../CONTRIBUTING.md); do not silently update
  toolchains while signing a tested candidate.
- Confirm store/package ownership and signing custodians privately. Source bundle
  IDs, team IDs and association fingerprints are configuration, not proof of
  certificate custody or store ownership.
- Reserve an unused monotonic build number/version code with the store owner.
  iOS defaults live in `ios/App.xcconfig`; the app's Info.plist derives its versions
  from build settings. Android accepts `podcst.release.versionName` and
  `podcst.release.versionCode`; developer defaults are not a release allocation.
- Inspect the resulting artifact's version, minimum OS, device families, package
  identity, permissions and entitlements. iOS currently includes iPhone **and iPad**;
  retain both device gates unless the owner explicitly narrows targeting. Check
  current store toolchain/target-API eligibility rather than assuming repository
  settings comply. Do not add billing without a separately approved scope.

## iOS archive and export

On an authorized signing Mac, set `RELEASE_DIR` to a new owner-protected directory
outside the checkout. `VERSION`, `BUILD_NUMBER` and `TEAM_ID` must be approved
values. Install the reviewed distribution certificate/profile using the approved
custody process, not a key or password in a shell argument. Avoid automatic
provisioning changes unless separately authorized.

```sh
umask 077
xcodebuild -project ios/Podcst.xcodeproj -scheme Podcst \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$RELEASE_DIR/derived" \
  -archivePath "$RELEASE_DIR/Podcst.xcarchive" \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  DEVELOPMENT_TEAM="$TEAM_ID" archive
```

Use Xcode's current App Store Connect export workflow to produce reviewed
`ExportOptions.plist` settings, kept privately. Verify the team, distribution
method (`app-store-connect` in current Xcode), provisioning/profile mapping and
`destination=export`. Set `manageAppVersionAndBuildNumber=false` to preserve the
reserved version. Do not accidentally select upload or development distribution.

```sh
xcodebuild -exportArchive -archivePath "$RELEASE_DIR/Podcst.xcarchive" \
  -exportOptionsPlist "$RELEASE_DIR/ExportOptions.plist" \
  -exportPath "$RELEASE_DIR/export"
shasum -a 256 "$RELEASE_DIR/export/Podcst.ipa"
```

Check the archive **and exported IPA** (export can re-sign): signature validity,
application identifier, team identifier, `get-task-allow=false`, associated domains
and embedded profile. Compare `dwarfdump --uuid` for the app and its dSYM. Release
builds generate dSYMs; retain the `.xcarchive`, exported IPA, dSYMs, export options,
checksums and sanitized toolchain/build receipt together. Missing or mismatched
symbols block distribution; do not regenerate them from a different build.

After separate upload approval, validate/upload through Xcode Organizer or
Transporter, then install the processed build through **TestFlight**. Record the
store build identity alongside the submitted IPA hash; Apple's processing means
the downloaded app is not necessarily byte-identical to that IPA. Prove both
clean install and update with retained pending work. A simulator or development
sideload does not establish this gate.

## Android AAB

Use an approved upload key, not the debug key. Configure the existing
`podcst.release.storeFile`, `storePassword`, `keyAlias` and `keyPassword` properties
in an owner-protected user-level Gradle properties file; keep the keystore outside
the checkout. Do not put passwords in commands, build logs or CI artifacts.

```sh
cd android
./gradlew --console=plain :app:bundleRelease \
  -Ppodcst.release.versionName="$VERSION" \
  -Ppodcst.release.versionCode="$BUILD_NUMBER"
```

The output is `app/build/outputs/bundle/release/app-release.aab`. Without signing
properties Gradle may produce an **unsigned** bundle. Inspect the JAR signature
and certificate using `jarsigner -verify -verbose -certs` and
`keytool -printcert -jarfile`; require a valid signature and the approved upload
certificate fingerprint, not merely exit zero. Validate the bundle and inspect
its manifest with the pinned `bundletool` version. Hash the AAB with
`shasum -a 256`, and copy it to the protected release directory before any rebuild.

Retain `app/build/outputs/mapping/release/mapping.txt`, native symbol files and
unstripped JNI libraries with the AAB and toolchain receipt. Release uses `FULL`
native debug symbols; verify the AAB's `BUNDLE-METADATA` actually contains them for
each shipped ABI. If producing APKs, inspect
`app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`.
App packaging and the engine share the pinned NDK and ABI list: do not ship an
ABI containing only a dependency's native code but no Podcst JNI library. Require
matching Podcst symbols for every shipped ABI. Pre-stripped third-party libraries
cannot regain debug information through this setting; obtain vendor symbols or
record the reviewed diagnostic limitation. A configuration flag is not proof.

Verify both ELF segment and APK ZIP alignment for **every** packaged native
library using the current [16 KB guidance](https://developer.android.com/guide/practices/page-sizes).
Check `bundletool dump config --bundle=...` for page alignment, inspect generated
and Play-delivered APKs with the selected SDK's `zipalign -c -P 16 4`, and run on a
16 KB environment. NDK/AGP version numbers alone are not evidence.

After separate upload approval, use **Play internal testing**, record its release
and artifact identity, and install from Play. Prove clean install and update.
Internal app sharing and local sideloading are not substitutes for the intended
internal-testing artifact. Under Play App Signing the installed APK uses the
**app-signing certificate**, not normally the upload certificate. Verify the
actual installed signer against Play Console, including any rotation lineage.

## Associations and authentication

Compare verified distribution identities with
[`native-apps.ts`](../src/server/auth/native-apps.ts), native entitlements and the
manifest. Coordinate changes with both authentication and link-routing behavior:
replacing fingerprints can break passkeys as well as links.

Before association activation, deploy and verify the public lookup and anonymous
web fallback. Both supported hosts must serve AASA and assetlinks as HTTPS 200 JSON
without redirects; preserve credential relations and the restricted link paths.
Test cold/warm links from external apps, both hosts, installed/uninstalled fallback,
guest/offline/error paths, superseded links and passkey registration/sign-in on
store-installed physical devices. Cached OS association state requires actual
device evidence, not just successful HTTP requests.

## Privacy and submission review

The app's bundled `PrivacyInfo.xcprivacy` declares these source-observed required
reason uses, checked against Apple's
[reason definitions](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons):

| Category / reason | App use |
| --- | --- |
| User defaults / `CA92.1` | App-owned library and API cache settings |
| File timestamp/metadata / `C617.1` | Metadata of downloaded/cache files within the app container |
| System boot time / `35F9.1` | Elapsed playback calculations, not off-device boot-time reporting |
| Disk space / `85F4.1` | User-visible download storage/free-space display, not remote reporting |

This is **not** a completed collection/tracking disclosure or a dependency audit.
Generate Xcode's privacy report from the final archive, inspect all embedded SDK
manifests and native dependencies, and review the actual network/data flows.
Reconcile account/email data, private feed locators, listening/library state,
caches, diagnostics and backup retention with the privacy policy and store forms.
Do not assert no data collection because playback can be anonymous.

Before public submission, record reviewer/date/current official requirements and
owner acceptance for:

- [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
  [privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
  and [App Privacy details](https://developer.apple.com/app-store/app-privacy-details/).
- [Google user-data/deletion policy](https://support.google.com/googleplay/android-developer/answer/10144311),
  [testing eligibility](https://support.google.com/googleplay/android-developer/answer/14151465),
  [target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878),
  [app signing](https://developer.android.com/studio/publish/app-signing),
  [foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
  and native page sizes.
- Accurate screenshots/features, age/audience declarations, support contact and
  escalation, accessible deletion entry points and truthful retention/remote-device
  limits. Provide reproducible review access without an authentication bypass or
  credentials in public docs.
- Final physical accessibility/audio/state evidence and deletion/recovery gates.
  Unimplemented, untested or owner-undecided behavior stays blocked; internal store
  acceptance or green CI does not approve public submission.

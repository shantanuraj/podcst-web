# Native chapter artwork

The iOS and Android players read embedded chapter pictures directly from media,
independently of the [web chapter endpoint](web-chapters.md).

## Presentation and timing

- The full player, compact player and mini-player display the active embedded
  image. Images fit within the artwork square without cropping diagrams/text.
  System Now Playing/Android media-session artwork follows the same selection.
- Ordinary episode/podcast artwork remains the fallback for chapters without an
  image, gaps, invalid pictures, loading and failures. The background tint remains
  based on the episode cover, so transient images do not recolor the player.
- Chapter timestamps use original-source time, independent of playback speed.
  Image intervals are half-open: start is inclusive, end is exclusive. Seeking
  backwards recomputes the image rather than retaining the last displayed one.
- A top-level ID3 CTOC and its nested tables define navigation membership.
  Unreferenced CHAP entries are hidden visual cues: they do not appear in chapter
  lists, counts, seek-bar segments or previous/next destinations. Without a
  top-level table, chapters remain navigable. Cycles and missing references are
  handled without recursive traversal.
- An active hidden image takes precedence over visible chapter artwork. Among
  overlapping hidden images, the latest start wins. When it ends, the currently
  visible chapter image resumes, or the episode cover if none exists.
- A visible image ends at the earlier of its explicit end and the next visible
  chapter boundary. An unknown end uses the next visible chapter or duration.
  Hidden cues with unknown ends use the next hidden cue or duration.
- An image-only timeline still works when there are fewer than two navigation
  chapters; show-note navigation remains the fallback in that case.

## Extraction and lifecycle

### iOS

Plain leading ID3v2.3/v2.4 tags are read through the existing account-scoped
`MediaStore`, including completed downloads and cached byte ranges. Metadata
reads have lower priority than playback reads and reuse the source's HTTP
validation and representation checks. No separate chapter/image disk cache is
created. The tag is limited to 16 MiB, 4,096 frames per level and 1,000 chapters.
Unsupported flags, extended headers, unsynchronization and malformed frames
fall back to the existing AVFoundation chapter-group path. That path also reads
artwork where AVFoundation provides it.

A temporary media lease is released after extraction. Source changes cancel old
work and reject its results by playback generation, not just episode identity.
Account transitions await chapter-task retirement before purging the media store.
Chapter metadata and loaded system artwork are cleared at the account boundary.

### Android

The player reads CHAP/APIC and CTOC entries already decoded by Media3; it does not
make another network request. ID3 `ChapterFrame.isHidden` alone is insufficient,
so the adapter computes table membership explicitly. Non-ID3 Media3 chapter
visibility is preserved. Metadata conversion and picture decoding run off the
main thread, with cancellation and source identity checks before publication.
Media3's format support and handling of malformed/sentinel chapter timestamps
remain decoder limitations; this change does not replace its ID3 parser.

Artwork is sampled to at most 1,024 pixels and encoded to at most 512 KiB before
entering player state/media-session metadata. Coil's chapter-image requests use
neither its memory nor disk cache. Queue/source changes and account transitions
clear chapter state; no chapter binary data is persisted in the database.

Both platforms accept embedded JPEG/PNG APIC data up to 4 MiB per picture and
reject dimensions over 16,384 pixels on either axis. Android limits accepted
source artwork to 16 MiB total and reads at most 1,000 chapter entries. Episode-wide
APIC frames are not mistaken for chapter images. Linked APIC images (`-->`),
external chapter feeds and chapter links are not fetched or presented in this
first slice. The bounded image data is decoded at display size; failure preserves
normal cover art and never blocks playback.

## Verification

The generated [shared fixtures](../contracts/fixtures/media/README.md#native-chapter-artwork)
exercise red visible artwork, a finite blue hidden cue, an image-free chapter,
and a final blue chapter in both ID3 versions. Native tests cover selection at
boundaries, reverse seeking, nested/missing tables, malformed images, and source
retirement. The Bun fixture tests verify deterministic bytes and raw subframes.

```sh
bun test scripts/fixtures/mp3-chapters.test.ts

(cd android && ./gradlew :core:model:test :core:playback:testDebugUnitTest \
  :feature:player:compileDebugKotlin)

xcodebuild -project ios/Podcst.xcodeproj -scheme PodcstTests \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:PodcstTests/ChapterArtworkTests \
  -only-testing:PodcstTests/PlaybackNowPlayingTests test
```

Run from the repository root, using an available simulator. Automated tests do
not establish physical-device rendering, lock-screen transitions, AirPlay or
Chromecast behaviour. Cast receivers may not expose local embedded metadata.
Manually test visible and hidden image boundaries, reverse seeks and account or
episode changes.

# Synthetic MP3 chapter fixtures

Regenerate from the repository root with `bun scripts/fixtures/mp3-chapters.ts`.
No encoder, network access, commercial audio or native-client changes are required.
The web tests compare generated and checked-in bytes.

Both files contain 320 zero-filled MPEG-1 Layer III frames (128 kbps, 44.1 kHz,
stereo, 417 bytes each; approximately 8.36 seconds of silence). The preceding
ID3 tags differ only in version and title encoding: v2.3 uses UTF-16LE with BOM,
v2.4 uses UTF-8. These fixtures also decode with FFmpeg.

| Title | Original-source start (seconds) |
| --- | --- |
| Opening | 0 |
| A synthetic topic | 2 |
| Résumé & finish | 4.5 |

CHAP frames are deliberately not in chronological order. The top-level CTOC
references the last chapter and a nested CTOC containing the first two. Consumers
should produce the flat timeline above. These files are available for later
native-client tests; this change does not wire them into native test targets.

Malformed, oversized, cyclic-CTOC and missing-title fixtures are generated in
memory by the web tests using the same fixture helpers.

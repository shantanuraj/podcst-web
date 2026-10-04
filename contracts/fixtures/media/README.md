# Synthetic MP3 chapter fixtures

Regenerate from the repository root with `bun scripts/fixtures/mp3-chapters.ts`.
No encoder, network access, commercial audio or native-client changes are required.
The web tests compare generated and checked-in bytes.

`chapters-v23.mp3` and `chapters-v24.mp3` contain 320 zero-filled MPEG-1 Layer III frames (128 kbps, 44.1 kHz,
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

## Native chapter artwork

`chapters-artwork-v23.mp3` and `chapters-artwork-v24.mp3` contain 640 silent
frames and generated 2×1 PNG images. The iOS and Android tests consume these
same files. A nested CTOC lists only Opening, No artwork and Ending:

| CHAP ID | Title | Start–end (seconds) | Image | In navigation |
| --- | --- | --- | --- | --- |
| opening | Opening | 0–4 | Red | Yes |
| visual | Empty | 2–3.5 | Blue | No |
| topic | No artwork | 4–8 | None | Yes |
| ending | Ending | 8–12 | Blue | Yes |

The hidden cue overrides the opening image only during `[2, 3.5)`. The red
image resumes at 3.5; episode art resumes at 4 and again at 12. Seeking in
both directions must produce the same result. Hidden cues never add chapter
rows or seek-bar segments and are not previous/next-chapter destinations.
No commercial media or remote image requests are involved.

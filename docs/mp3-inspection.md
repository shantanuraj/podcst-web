# MP3 metadata inspector

[`scripts/inspect-mp3.ts`](../scripts/inspect-mp3.ts) is a read-only Bun CLI. It
needs no database, Redis or API credentials.

```sh
bun scripts/inspect-mp3.ts ./episode.mp3
bun scripts/inspect-mp3.ts contracts/fixtures/media/chapters-artwork-v24.mp3
bun scripts/inspect-mp3.ts https://example.org/episode.mp3
bun scripts/inspect-mp3.ts --help
```

It also accepts file URLs, public Podcst episode-page URLs, or a numeric
`podcast_id/episode_id` pair. Numeric pairs resolve the enclosure from public page
metadata; use `--base-url http://localhost:3000` for a development instance.
Authenticated pages are unsupported. Prefix numeric local paths with `./`, quote
shell metacharacters, and use `--` before filenames beginning with a dash.

## Output

The command writes JSON to stdout and errors to stderr, exiting 1 on failure.
The report includes source/HTTP diagnostics, leading ID3 header details, audio
format, normalized metadata, native tags and decoder warnings.

```sh
bun scripts/inspect-mp3.ts ./episode.mp3 | jq '.native'
bun scripts/inspect-mp3.ts ./episode.mp3 \
  | jq '[.native[][] | select(.id == "CHAP")]'
```

CHAP/CTOC subframes retain native millisecond timestamps, titles, URLs and pictures.
Top-level APIC is episode artwork; APIC nested in CHAP is chapter artwork. Binary
values become byte-length and SHA-256 summaries; `--binary` also includes base64.
Linked pictures expose their URL without fetching it.

This is decoded metadata, not a lossless raw-frame dump. Unsupported and repeated
frames remain subject to `music-metadata`'s behaviour. Code can use
`inspectMp3(input, options)` and `serializeTags(report, binary)` directly.

## Limits and private data

Remote files download **in full** to a private temporary directory so trailing
tags can be read. The file is removed on success and handled failure. Local files
are read in place. Audio is not buffered entirely in memory, but large metadata
or artwork can still consume memory.

Defaults are a 512 MiB download limit, 120-second network deadline, ten redirects
per request chain and a 2 MiB episode-page limit. Use `--max-bytes` and `--timeout`
to override download bounds. Local parsing is not subject to these limits.

Unlike the web chapter endpoint, this is an explicit-input local tool: URLs may
reach local or private hosts. Reports can contain paths, credentials in URLs,
redirect targets, headers and private tags. Review and redact before sharing;
keep captures outside the repository.

## Tests

```sh
bun test scripts/inspect-mp3.test.ts
```

Tests use synthetic MP3s and a local HTTP server.

# Web chapters

The web player uses Howler; chapter loading is independent of audio loading.
Missing or failed metadata must never block playback. The
[chapter endpoint](../contracts/api/README.md#get-apiepisodesepisodeidchapters--optional-web)
returns normalized original-source timestamps, not enclosure URLs or artwork.

## Formats

Leading MP3 ID3v2.3/v2.4 CHAP frames are decoded by `music-metadata` after a framing
check. Unsupported flags, malformed tags and other containers fall back to show
notes. CTOC traversal handles cycles and missing references; presentation remains
a flat timeline sorted by start time, with duplicate starts removed.

A usable timeline needs at least two chapters. Starts use original-source seconds
and are not clamped to unreliable feed duration. Titles are normalized and rendered
as text; empty titles receive localized labels. Show-note fallback follows the
[shared vectors](../contracts/playback/README.md#shownotesjson); unsorted or
duplicate starts invalidate that list.

The web timeline does not implement the native players'
[embedded artwork and hidden cues](native-chapter-artwork.md).

## Playback and account scope

Episode pages and the player show the same keyboard-accessible chapter controls.
Previous/next rules come from `contracts/playback/rules.json`; system track
commands are unchanged. Seeking uses the shared playback action, including
Chromecast and restored paused episodes. No alternate chapter player is created.

Queries are scoped by account revision and episode database ID, never private
URLs, and are not persisted. Account changes cancel and purge them; late results
from retired sessions are discarded. Show-note chapters remain usable while
metadata is loading or unavailable.

## Fetching and privacy

Every request authorizes the episode through its parent podcast before accessing
any cache. The server resolves the enclosure from authorized stored content; it
never accepts a caller-supplied URL. Responses use `private, no-store` and
`Vary: Cookie`, even for public episodes.

The HTTP reader validates and pins public DNS destinations on every redirect,
preserves TLS verification and forwards no cookies or application credentials.
It reads only a bounded leading tag, using byte ranges and representation
validators, rather than downloading the episode. Invalid ranges, compressed
responses, changed resources and truncated tags are rejected. Deadlines, redirect,
frame and body limits live in the [HTTP reader](../src/server/chapters/http.ts)
and [parser](../src/server/chapters/mp3.ts).

## Cache behaviour

The request path is authorization → in-memory L1 → Redis → bounded extraction.
Cache identity includes ownership, episode ID, a hash of the enclosure locator,
media properties and parser/schema version. Raw URLs are not cache keys or log
fields. Show-note fallback is parsed from current content rather than cached.

Successful embedded metadata is retained for six months and revalidated after a
week. A five-minute L1 avoids repeated Redis reads without extending freshness or
retention. Negative results expire sooner. A failed refresh can retain the old
timeline until its original expiry; it does not renew successful retention.

Background revalidation checks ownership and enclosure identity again. HTTP
validators apply only to the same final resource. Redis ownership tokens and
atomic publication prevent late workers from overwriting newer results. Local
in-flight requests share work; concurrency and deadlines are bounded. Redis
failure degrades to L1, bounded extraction or show notes, never failed playback.

Bump `CACHE_VERSION` when changing normalization or stored shape. See the
[cache service](../src/server/chapters/service.ts) and
[Redis adapter](../src/server/chapters/redis.ts) for lifecycle and limits.

Same-URL ad insertion or personalized media can shift timestamps. Server metadata
cannot guarantee alignment with a different representation heard by the browser.

## Tests

```sh
bun test src/server/chapters src/shared/chapters.test.ts \
  src/data/chapters.test.ts src/shared/player/chapter-playback.test.ts \
  src/ui/EpisodeInfo/Chapters.test.tsx
```

Set `TEST_DATABASE_URL` and `TEST_REDIS_URL` to disposable services for integration
coverage. [Synthetic MP3 fixtures](../contracts/fixtures/media/README.md) require
no publisher audio. Also test supported browsers, keyboard/screen-reader controls,
real casting devices and ad-inserting media; automated tests do not cover those
physical playback paths.

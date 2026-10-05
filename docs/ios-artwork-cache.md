# Artwork sizing and caching

## Server contract

Artwork URLs are opaque except for the supported width parameter on the public
artwork host. The host and widths live in
[`contracts/playback/rules.json`](../contracts/playback/rules.json) under `artwork`.
Request the smallest width that meets the display's pixel size; use the original
when no variant is large enough. Preserve the source URL's query parameters.

Sized responses are square WebP images without upscaling. Unsized requests return
the original. Clients use HTTP freshness and validators for revalidation. Sizing
must not reroute private artwork through the public service.

## Web

[`ProxiedImage`](../src/ui/Image/ProxiedImage.tsx) supplies responsive variants
for already-proxied artwork. A permitted direct-image failure gets one proxy
fallback; an already-proxied failure is terminal to prevent recursive requests.
React owns both `src` and `srcset`, and a source change resets fallback state.

## iOS

[`ArtworkStore`](../ios/Podcst/ArtworkStore.swift) downsamples off the main actor
at the requested display size. One account-scoped store owns compressed artwork;
library, queue and download references determine retention rather than a second
stored ownership list. Unreferenced browsing artwork is evicted within a quota.

Cached images stay visible while revalidating or offline. Smaller cached variants
can appear before larger ones arrive. Signing out or switching accounts cancels
pending work and removes the previous account's artwork. System Now Playing uses
the loaded image rather than repeatedly encoding and decoding it.

Artwork retention does not imply downloaded audio availability. Check
[`ArtworkStoreTests`](../ios/PodcstTests/ArtworkStoreTests.swift) and
[web artwork tests](../src/shared/artwork.test.tsx) for cache and fallback behaviour.

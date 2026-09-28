# iOS artwork measurements

Measured September 28, 2026; source audited at commit `5362369`. This records the baseline before image-loading and caching changes. References to the current loader below describe that commit. The subsequent implementation and transport measurements are recorded in [Artwork sizing and transport](ios-artwork-cache.md).

The current loader reduces decoding to a maximum of 1024 pixels, but downloads the complete source image for every frame size. The existing HTTP cache does reuse images, yet it does not guarantee that library or queue artwork remains available offline. Smaller decoded variants and deliberate disk retention address different problems and should be evaluated separately.

## Physical iPhone baseline

Instruments Activity Monitor attached to the already-running Podcst app on an iPhone 14 Pro, iOS 27.0 (24A5430a). The 69.642-second recording began at 16:12:22.988 UTC. The app and its caches were warm. Playback remained paused during both memory and HTTP recordings. Navigation used Device Hub; screen markers followed navigation and screenshots, so they are approximate rather than instrumentation signposts.

| Settled screen interval | Median whole-app physical footprint |
| --- | ---: |
| Library, seconds 1–10 | 82.03 MiB |
| Discover top, seconds 18–27 | 82.80 MiB |
| Discover bottom, seconds 36–41 | 96.85 MiB |
| Queue, seconds 49–52 | 85.91 MiB |
| Full player, seconds 59–68 | 86.28 MiB |

The trace peaked at **144.10 MiB during Discover scrolling**, about 62 MiB above settled Library. This is whole-app memory, including playback, layout, caches, and transient work. It is not an image-only allocation measurement. The mini player remained part of the navigation experience; its memory was not isolated by toggling it off.

### Physical iPhone HTTP recording

A separate HTTP-only Instruments recording in Immediate mode relaunched the app at 16:30:05.453 UTC and ran for 134.341 seconds with its existing disk cache intact. All 50 HAR records were valid: **47 image URL tasks and three API tasks**. Explicit fetch types identify **23 image network loads and 24 local-cache hits**. This was a relaunch after prior browsing, not a cleared-cache first launch.

| Approximate phase | Image network loads | Image local-cache hits | Downloaded image content |
| --- | ---: | ---: | ---: |
| Launch and Library | 3 | 13 | 2,593,435 B / 2.47 MiB |
| Discover top | 3 | 4 | 3,744,513 B / 3.57 MiB |
| Discover scrolling / bottom | 15 | 6 | 15,603,231 B / 14.88 MiB |
| Queue | 2 | 1 | 1,312,595 B / 1.25 MiB |
| Full player | 0 | 0 | 0 B |

The phone downloaded **23,253,774 bytes / 22.18 MiB of image content despite the existing disk cache**. Discover accounted for 18.45 MiB. The profiler reported 23,257,916 image response-body bytes and another 6,520 API response-body bytes. Image-content totals exclude headers and TLS/transport overhead; they are not a measurement of all interface traffic. The slowest image task took 3.591 seconds during Discover scrolling.

All 23 downloaded artwork URLs were absent from the preceding disk snapshot, matching the missing library, Discover, and queue corpus exactly. The two queue images were also confirmed network loads in the earlier HTTP run: they downloaded again on this relaunch. One was podcast-cover fallback and one was episode-specific artwork.

The mini player's current artwork was an explicit local-cache hit at launch, completing in 10 ms with zero response-body transfer. Opening the full player caused no additional URL tasks; it reused already-loaded current artwork. Phase boundaries follow request bursts and approximate UI navigation markers, rather than app signposts.

## What is downloaded and decoded

The source audit found one shared loader in [Components.swift](../ios/Podcst/Components.swift). `ArtworkStore` downloads the exact URL with `URLSession.shared`, uses ImageIO to decode at a maximum of 1024 pixels, deduplicates concurrent requests by URL, and keeps decoded images in an NSCache with a 64 MiB cost limit and a 160-entry limit. There is no frame-size input or explicit artwork disk store.

`ArtworkView` also retains its loaded image in view state. The NSCache limit therefore does not bound all artwork memory; retained views, compressed HTTP bodies, decoder buffers, GPU resources, and lock-screen artwork contribute separately. Lock-screen artwork uses this same loader, then creates a JPEG copy for `MPMediaItemArtwork` in [PlaybackController.swift](../ios/Podcst/Playback/PlaybackController.swift).

| Surface | Frame in points | Required pixels at 3× |
| --- | ---: | ---: |
| Discover featured cover | 128 | 384 |
| Discover and search row | 52 | 156 |
| Library grid on a 393-point-wide screen | 109.7 | 329 |
| Library episode row | 48 | 144 |
| Mini player | 44 | 132 |
| Queue current / upcoming | 52 / 48 | 156 / 144 |
| Full player maximum | 300 | 900 |

The library grid width is `(available width − 40 points outer padding − 24 points column gaps) / 3`. These are source-defined dimensions in [DiscoverView.swift](../ios/Podcst/DiscoverView.swift), [LibraryView.swift](../ios/Podcst/LibraryView.swift), [RootView.swift](../ios/Podcst/RootView.swift), [QueueView.swift](../ios/Podcst/QueueView.swift), and [NowPlayingView.swift](../ios/Podcst/NowPlayingView.swift). Actual pixel targets must use the view's resolved size and display scale.

### Public Discover transfer sample

A separate Mac measurement fetched `/api/top?locale=us&limit=30` from production, then downloaded each exact cover and thumbnail URL. All 30 cover URLs match the device's cached Discover list. These are measured compressed response-body sizes, not iPhone cold-launch traffic or transport overhead.

| Public top-30 corpus | Result |
| --- | ---: |
| Cover responses | 30 successful |
| Cover body bytes | 21,391,431 B / 20.40 MiB |
| First eight cover bodies | 3.01 MiB |
| Median cover body | 614.23 KiB |
| Cover dimensions | 19 × 3000²; 6 × 1400²; 2 × 256²; one each 1800², 1890², 2000² |
| Thumbnail body bytes | 1,170,787 B / 1.12 MiB |
| Thumbnail dimensions | 29 × 100²; one fallback at 3000² |

All 30 cover responses came from the existing assets proxy and advertised `public, max-age=31536000, immutable`. All had Last-Modified; 22 had ETag. Long freshness is already present. More cache lifetime alone will not reduce the first download or guarantee retention.

The native podcast model always selects `cover`; it does not select `thumbnail` by frame size. Search maps the server's thumbnail into that cover field. Simply switching other screens to the existing 100-pixel thumbnails would be too small for a 156-pixel row on this phone.

For the complete cover corpus, square 8-bit RGBA pixel arithmetic gives 112.5 MiB at the current 1024-pixel maximum, versus 3.25 MiB at exact Discover frame sizes. These totals illustrate the decoding opportunity; neither is a measured simultaneous working set. Client-side downsampling alone cannot reduce the 20.40 MiB download.

### Mac reproduction of device image buffers

The device's cached image bytes were copied read-only and decoded on the Mac using the application's ImageIO options. Missing library/queue sources were measured separately to complete those corpora. The measurement records `CGImage.bytesPerRow × height`, including row alignment. It is a logical decoded-buffer measurement, not iPhone resident memory, and does not imply all images were resident together. Rows overlap and must not be added together.

| Image corpus | Current 1024 px maximum | 330 px maximum | 156 px maximum | 132 px maximum |
| --- | ---: | ---: | ---: | ---: |
| Initial disk cache, 45 images | 64,780,992 B | 8,440,032 B | 2,832,192 B | 2,334,528 B |
| Complete library, thirteen covers | 46,661,632 B | 5,344,928 B | 1,265,472 B | 906,048 B |
| Complete queue, four preferred images | 12,845,056 B | 1,576,864 B | 389,376 B | 278,784 B |
| Current episode image | 262,144 B | 262,144 B | 97,344 B | 69,696 B |

The current episode's source is only 256 × 256: sufficient for the 132-pixel mini player, but under-resolution for the full player's 900-pixel frame. A larger decoding target cannot restore absent detail; that requires a higher-resolution source. The six initially cached Discover covers alone produced 24 MiB of decoded buffers with the current options.

## Disk retention and offline gaps

The initial HTTP-cache snapshot contained 56 responses: 45 images occupying **4,253,942 bytes / 4.06 MiB**, plus 11 JSON responses. These are retained body bytes, not cumulative traffic or the size of the cache database itself.

After the memory-session browsing, the cache contained 51 images occupying **4,956,667 bytes / 4.73 MiB**. Six newly retained Discover covers added 702,725 bytes / 686.25 KiB, with no previous image entries removed. Their decoded buffers totaled 16.5 MiB under the current maximum. Snapshots after both HTTP-navigation sessions were unchanged: 51 images and the same body bytes, with successful SQLite integrity checks. **All 23 images downloaded in the complete HTTP run were still absent from disk afterward.** All 24 explicit local-cache hits matched retained URLs.

The complete preferred-artwork corpus was measured by combining retained image bodies with separate source downloads and the recorded queue responses. These are compressed content sizes, not aggregate phone transfer. Shared artwork can appear in more than one row, so the rows must not be added together.

| Surface | Distinct images | Complete corpus | Retained before and after relaunch | Retained content | Missing content |
| --- | ---: | ---: | ---: | ---: | ---: |
| Library, fourteen podcasts | 13 | 4,550,234 B | 10 of 13 | 1,956,799 B | 2,593,435 B |
| Queue, four items | 4 | 1,630,820 B | 2 of 4 | 318,225 B | 1,312,595 B |
| Discover | 30 | 21,391,431 B | 12 of 30 | 2,043,687 B | 19,347,744 B |

Preferred queue artwork means `episodeArt ?? cover`. Counting only nonempty `episodeArt` fields would give three URLs and omit the cover fallback. The initial snapshot alone could not distinguish never-requested artwork from eviction; the repeat recording confirmed that the missing images were fetched and still not retained afterward. The current episode art and its podcast cover were byte-identical but stored twice under different URLs, each 50,726 bytes. The URL-keyed decoded cache treats them separately too.

Discover coverage improved from six to twelve covers, but **18 covers totaling 18.45 MiB remained absent from disk** after browsing. Among Discover covers, the largest retained body was 473,079 bytes and the smallest absent body was 522,576 bytes. Apple's [response-caching documentation](https://developer.apple.com/documentation/foundation/urlsessiondatadelegate/urlsession%28_%3Adatatask%3Awillcacheresponse%3Acompletionhandler%3A%29) describes an approximately 5%-of-disk-capacity limit per response. That is a plausible mechanism for this pattern; the runtime cache capacity and admission threshold were not measured, so the cause is not established. Cache growth omits uncached and repeated transfers and protocol overhead and cannot stand in for complete network measurement.

The initial Instruments Network Connections recording crashed and the first HTTP-only run produced incomplete HAR data. The Immediate-mode HTTP recording above resolved that measurement gap. A true offline relaunch has not been tested; neither cache inspection nor a warm revisit substitutes for that test.

## Recommendations from the baseline

1. **Size images for their use.** Pass resolved frame size and display scale into the shared loader. Start with 160-pixel rows, 384-pixel Library/Discover browsing artwork, and 1024-pixel large artwork. Select the smallest sufficient bucket, bounded by source dimensions; never upscale a small source merely to fill a bucket. Derive smaller decoded variants from a larger source already available locally, and upgrade browsing artwork when a full image is needed. Retain the larger source fallback when no suitable remote variant exists. Use measured frame requirements for larger layouts rather than assuming these three sizes cover every device.
2. **Reduce transfer at the source where supported.** The repository only establishes the assets proxy's `p=sourceURL` contract; its server implementation and resizing contract are absent. Verify or implement server resizing before adding any width parameters. Keep source identity separate from size variants so list and player artwork can share retrieval without always downloading full originals. Do not introduce new public-proxy routing for private artwork.
3. **Use one shared store with explicit retention.** Pin library covers, current/queued episode artwork, and downloaded-episode artwork in app-managed persistent storage. For current, queued, and downloaded episodes, retain artwork suitable for the full player—its 900-pixel frame fits the 1024-pixel bucket—when the source allows it, while decoding small variants for rows. Fetch required artwork when content is retained, not only when its row happens to become visible. Keep one stored asset referenced by its owners; removal from one screen must not delete an asset still required elsewhere. Put retained downloads in Application Support with backup exclusion where appropriate, with account-scoped identity and cleanup for private assets.
4. **Keep browsing storage bounded.** Retain Discover artwork on disk with its cached chart so launch and offline browsing remain useful. Search-only artwork can start in memory, with a small disposable disk allowance only if measurements justify it. Viewing the same asset from Search and Library should promote its retention policy rather than duplicate bytes. Choose disk budgets after measuring resized variants and retained working sets. Pinning and opportunistic eviction are separate; expose storage management for retained content.
5. **Separate retention from freshness.** Keep usable artwork while revalidating in the background when its freshness policy requires it. Never blank an image merely because it is stale or a refresh fails. Respect validators and URL changes; the existing one-year immutable headers need server review for sources that replace content at the same URL. Begin with a **32 MiB decoded-memory budget as an experiment**, then measure scroll peaks, hit rates, and repeat decoding before selecting the final budget.

Offline quality should cover metadata, show notes, queue state, artwork, and explicitly downloaded audio together. A cached image is not evidence that an episode is downloaded. Keep download availability truthful, and preserve browsing and playback controls during connectivity changes.

Apple's [Image and Graphics Best Practices](https://devstreaming-cdn.apple.com/videos/wwdc/2018/219mybpx95zm9x/219/219_image_and_graphics_best_practices.pdf) demonstrates ImageIO downsampling using point size multiplied by display scale. [URLCache documentation](https://developer.apple.com/documentation/foundation/urlcache) confirms that disk responses can be purged under storage pressure. [iOS Storage Best Practices](https://developer.apple.com/videos/play/tech-talks/204/) distinguishes persistent Application Support files from disposable Caches files and describes excluding downloadable files from backup.

## Reproduction and next comparison

Local evidence for this run is under `/tmp/podcst-image-audit-20260928/`: `device-memory.trace`, `device-memory-samples.csv`, `device-memory-summary.json`, `device-http-run2-summary.json`, `device-http-run2-safe-transactions.json`, `device-cache-report.md`, `device-cache-summary.json`, `device-cache-after-run2-summary.json`, `device-image-decode.json`, `device-cache-duplicates.json`, `preferred-corpus-summary.json`, `measure_decode.swift`, and `public-images.json`. Device manifests identify source URLs by hashes; private URLs, account identifiers, raw app state, and artwork are not included in this report.

Repeat the same Library → Discover top → scroll to bottom → Queue → full-player sequence after any approved change, with matching playback state. Capture cold and warm runs separately, then relaunch without network connectivity. Record whole-app physical footprint, transient peaks, decoded variant sizes, request/body bytes, memory/disk/network hit counts, and artwork completeness. Test cache eviction separately from explicit retained-content removal. Compare visual sharpness at the actual display scale as well as byte savings.

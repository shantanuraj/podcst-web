# Artwork sizing and transport

Implementation and compression measurements from September 28, 2026. The [device baseline](ios-artwork-measurement.md) measured the original iOS loader. Numbers below measure local transformations and production API compression; they are not post-change iPhone traffic or memory measurements.

## Server contract

The existing artwork service is maintained in the sibling `img_proxy` repository. The implementation was rebased onto its latest `origin/main` at `c18bee7`, preserving the production loopback binding, exported server handler, and tracked systemd service. The server listens on `127.0.0.1` using `PORT` or 3102 by default; its public reverse proxy remains responsible for external access. Its `p` parameter identifies the source image. Adding `w=160`, `w=384`, or `w=1024` produces a square WebP image bounded by that size on each edge. It preserves orientation and scales without stretching, then crops centrally to match the native app's square artwork frames. The output edge is limited by the source's shorter edge, so a 100 × 60 source produces a 60 × 60 crop without upscaling. The selected quality is 82. Requests without `w` continue to return original bytes for the web client.

The native client should add the width parameter only to URLs already served by `assets.podcst.app`, preserving their existing source value. Direct URLs retain their existing route. This introduces no new public-proxy routing for private artwork. Image sizing and HTTP compression are separate: raster images use their image codec, while JSON uses the server's negotiated HTTP encoding.

Successful proxy responses use a one-day freshness lifetime and seven-day stale-while-revalidate window. Content-derived ETags support bodyless 304 responses. Stale artwork remains useful locally even after freshness expires. The source's Last-Modified is preserved; the proxy no longer labels mutable sources immutable.

Per-process admission is limited to eight active requests. Additional requests return an uncached 503 with Retry-After of one second. Source fetches have a 15-second timeout, a 16 MiB compressed-body limit, and a 16-megapixel decoder limit. Tests cover invalid parameters, source query preservation, square cropping of landscape and portrait sources, no upscaling, validators, source errors, raster validation, body/pixel limits, and admission/recovery. Upstream error bodies and Set-Cookie headers are not relayed. The service's existing arbitrary-source fetch capability is not a complete SSRF defense; scheme validation and payload limits do not enforce an egress policy or prevent DNS rebinding.

Search responses now include the full `cover` URL alongside `thumbnail`. iTunes search already supplied cover artwork; database URL search now supplies it too. A 100-pixel search thumbnail is insufficient for the native 156-pixel row frame.

## Measured image format choice

The exact 30 public cover files collected for the baseline were resized locally with Sharp 0.34.5. Each original was encoded once per size and format. All 30 source covers were square; repeating the 90 WebP transformations after changing the service to square cropping produced identical byte totals. Times include source decoding, orientation, resizing, and encoding; decode timings use Sharp on the Mac, not iPhone ImageIO. They are an indicative single pass under local system load, not a controlled server throughput benchmark.

| Thirty-cover corpus | WebP quality 82 | AVIF quality 60, effort 4 | WebP encode time | AVIF encode time |
| --- | ---: | ---: | ---: | ---: |
| 160 px | 154,462 B | 138,276 B | 0.843 s | 1.966 s |
| 384 px | 554,878 B | 463,750 B | 1.080 s | 2.723 s |
| 1024 px | 2,696,030 B | 2,105,857 B | 3.324 s | 10.531 s |

The actual Discover layout has one 384-pixel featured cover and 29 160-pixel rows. Its local WebP output totals **157,568 bytes**, compared with **21,391,431 bytes** for the original sources: a 99.26% reduction in image bodies. AVIF totals 139,930 bytes for that layout, saving a further 17.2 KiB, with approximately 2.3 times the local encoding time and 1.4 times the local decoding time. These quality settings are not perceptually matched, so the comparison does not establish equivalent visual quality.

WebP remains the selected output: fitting the image to its frame produces the dominant reduction, and AVIF's additional saving is small for the measured browsing layout. ImageIO was directly exercised on the installed **iOS 18.0 simulator, build 22A3351**; it successfully decoded generated WebP and AVIF sources into 160-pixel thumbnails. Both formats are technically viable at the app's deployment target. Apple's [WebKit release notes](https://webkit.org/blog/13399/webkit-features-in-safari-16-1/) also document AVIF support starting with iOS 16.

Additional HTTP compression over 160-pixel WebP files increased total bodies from 154,462 bytes to 154,582 with Brotli, 155,152 with gzip, and 154,762 with Zstandard. At 384 pixels all three also increased the total. The proxy therefore adds no extra HTTP compression layer to artwork.

## API compression already in production

Requests to `https://www.podcst.app/api/top?locale=us&limit=30` identified the current serving layer as Vercel, despite the repository also containing Fly deployment configuration. The response body was measured without curl's automatic decompression.

| Accept-Encoding request | Response Content-Encoding | Transferred body |
| --- | --- | ---: |
| identity | none | 17,911 B |
| gzip | gzip | 5,638 B |
| br | br | 5,636 B |
| zstd | none | 17,911 B |
| gzip, deflate, br, zstd | br | 5,636 B |

An unmodified URLSession on the iOS 18.0 simulator received Brotli from this endpoint and returned valid JSON with the original 17,911-byte decoded length. The application should let URLSession advertise its supported encodings and decompress responses; it does not need a Brotli package or an Accept-Encoding override. Apple documents [URLSession Brotli support since iOS 11](https://developer.apple.com/videos/play/wwdc2018/714/), and [Vercel handles compression at its serving layer](https://vercel.com/docs/how-vercel-cdn-works).

A separate local encoding comparison of the same JSON yielded 5,564 bytes with gzip level 6, 5,524 with Brotli level 4, 5,271 with Brotli level 6, and 5,609 with Zstandard level 3. Median encoding times across 50 iterations were 0.194 ms, 0.154 ms, 0.634 ms, and 0.058 ms respectively. Those results do not justify introducing an application compression layer over the already-compressed production response. Zstandard is not required for the iOS 18 target; [Safari's Zstandard support arrived in 26.3](https://webkit.org/blog/17798/webkit-features-for-safari-26-3/), which is not a guarantee of support across earlier native URLSession versions.

No Next.js compression configuration was changed, and no custom native decoder was added.

## Deployment and verification

1. Update the `img_proxy` checkout at `/opt/img_proxy` through the existing deployment process, install dependencies there with `bun install --frozen-lockfile`, and restart `podcst-img-proxy.service`. Install Sharp for the server's OS and architecture, rather than copying Mac dependencies. The tracked `systemd/podcst-img-proxy.service` runs Bun as `svc-podcst`, with its existing sandboxing and loopback binding retained. No service-unit change is needed for this release.
2. Verify the live proxy returns the expected WebP dimensions for each width, distinct variant ETags, the new freshness header, and 304 for a matching validator. Ensure any intermediary cache includes `w` as well as `p` in its key. The previous proxy ignores `w`; deploying the app first would still download full originals. Previously cached unparameterized responses can retain the old immutable lifetime until expiry or invalidation.
3. Deploy `podcst-web` so database search returns `cover`, then release the native client. No database migration is needed for these server changes.
4. Repeat the physical-device baseline sequence with cold and warm caches, then test offline relaunch. Attribute transfer reductions to live resized responses only after verifying their dimensions. Preserve the original baseline rather than replacing its whole-app memory measurements with theoretical buffer savings.

No production deployment or database mutation was performed as part of this implementation. Local comparison evidence is under `/tmp/podcst-image-audit-20260928/`: `proxy-resize-measurement.json`, `modern-artwork-formats.json`, `api-compression-headers.json`, and `api-local-compression.json`. Only aggregate measurements appear here; private source URLs, account state, and cached private images are excluded.

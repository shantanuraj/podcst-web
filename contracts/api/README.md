# Podcst API contract for native clients

This contract describes the API used by the native clients. Route handlers live in `src/app/api/`; the [fixture index](../fixtures/api/index.json) lists example bodies, HTTP statuses and client decoding types. Update fixtures and both clients' tests when changing a response.

## Conventions

**Base URL.** Production is `https://www.podcst.app` (`ios/Podcst/Core/APIClient.swift:10`). All bodies are JSON. Request bodies are sent with `Content-Type: application/json`.

**Session.** Successful email-code login and passkey verification insert a 40-character hexadecimal session ID in their verification transaction, revoke the previously presented session, and set the cookie `session=<id>` with `Path=/`, `HttpOnly`, `SameSite=lax`, `Secure` in production and an expiry 30 days after creation. Nothing extends the expiry. Native clients do not use a cookie jar: they read `session=` from the first `Set-Cookie` header of any response, store the value in secure storage and send `Cookie: session=<value>` on authenticated requests (`APIClient.persistCookie`, `APIClient.request`). Logout deletes the server row and clears the cookie. An expired or unknown session is indistinguishable from no session. All authentication responses are private/no-store, including errors. API mutations require the configured browser Origin (with same-origin Fetch Metadata when supplied), or the explicit native path: `X-Podcst-Client: native` without Origin/Fetch Metadata. Native clients send that header, including on logout. The native marker is a CSRF request-shape check, not an authentication credential; session and ownership checks still apply.

**Authorization classes.**

| Class | Behaviour without a valid session |
| --- | --- |
| Public | Works; private podcasts are invisible. |
| Optional | Works; with a session, the caller's own private podcasts also become visible. |
| Required | Rejected with 401. |

**Private-feed headers.** Responses that can contain private data carry `Cache-Control: private, no-store` and `Vary: Cookie` (`privateFeedHeaders` in `src/server/podcast-access.ts`). The table below notes which responses carry them. Clients must not place those bodies in shared caches. Podcast visibility is decided only by `podcasts.owner_user_id` (`podcastAccess` in the same file); `isPrivate` in responses is a derived projection, never an authorization input.

**Error bodies.** Deliberate errors contain `message`. Durable progress/follow/list routes additionally return the stable `code` described in the [state contract](../state/README.md); clients must not branch on English messages. `/api/top` has no deliberate error response.

The messages are human-readable English, not stable codes; clients branch on the HTTP status and show `message`. Routes that read a JSON body treat a malformed or `null` body as an empty object, so it fails their validation with 400 `ErrorMessage` (`src/app/api/errors.test.ts`). Unhandled database or upstream failures on any route produce a 500 without a defined body.

**IDs, numbers and nulls.** PostgreSQL bigint decoding stays exact. Catalogue and Apple IDs are canonical decimal strings from `1` through `9223372036854775807`; numeric wire IDs are rejected. Genre/category IDs, counts and times remain numbers. Timestamps (`published`) are epoch milliseconds; `duration` is whole source seconds. Omitted fields differ from explicit `null`. Durable scope is `{protocol:1, accountId, generation}`; a resource stream adds `clientId` and decimal-string `sequence`. An expected account is an assertion, never authentication authority.

**Artwork.** `cover`, `thumbnail` and `episodeArt` are opaque URLs. A URL on `assets.podcst.app` may receive a `w` parameter to request a square WebP variant; the permitted widths live in [`contracts/playback/rules.json`](../playback/rules.json) under `artwork`, and the server behaviour is documented in [Artwork sizing and transport](../../docs/ios-artwork-cache.md#server-contract). Private artwork is served directly, never through that host.

**Titles.** Titles and descriptions are stored as the feed supplied them. Some contain HTML entities, for example the captured `top.nl.json` title `Maarten van Rossem &amp; Tom Jessen`; clients decide how to render them.

## Shared shapes

### Podcast and episode objects

`Podcast` is the server type `IPodcastEpisodesInfo` (`src/types.ts`), produced by `getPodcastById` (`src/server/ingest/podcast.ts`) and, with a different key order, by `getSubscriptions` (`src/server/subscriptions.ts`).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | decimal string | Canonical podcast identity. |
| `isPrivate` | boolean | |
| `feed` | string | The stored feed URL. For a private podcast it can contain credentials; never log, display in full or share it. |
| `title`, `author`, `cover` | string | |
| `description` | string | `""` when the feed has none. |
| `link` | string or null | Website URL. |
| `published` | integer or null | From `/api/feed`: the podcast's last publication time. From `/api/subscriptions`: the newest returned episode's time. |
| `explicit` | boolean | |
| `keywords` | array | Always `[]`. |
| `episodes` | `Episode[]` | Newest first. All episodes from `/api/feed`; at most two from `/api/subscriptions`. |

`Podcast` has no `thumbnail`, `itunes_id`, `count` or `episodeCount`. A client needing the episode count of a full `Podcast` uses `episodes.length`; for a subscription, where only two episodes are returned, it must call `/api/feed/info`.

`Episode` is `IEpisodeInfo`. The schema keeps episode content in a separate table that can be evicted for podcasts nobody follows (`src/server/tiering.ts`), and an episode dropped from its feed keeps its identity row without content. Catalogue and progress endpoints join `episode_content` and omit episodes without content (`getPodcastById`, `getEpisodeById`, `readEpisodePage`, `getSubscriptions`, `getCurrentProgress`), so `title` and `file.url` are always present and their counts include only returned episodes. List responses retain memberships without accessible content as nullable episode entries, described below.

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `podcastId` | decimal string | Exact canonical identities. |
| `isPrivate` | boolean | Copied from the podcast. |
| `feed`, `podcastTitle`, `cover`, `author` | string | Copied from the podcast. |
| `guid` | string | Unique within the podcast. |
| `title` | string | |
| `summary` | string or null | Show notes HTML. |
| `showNotes` | string | Always `summary ?? ""`. |
| `published` | integer | The column is `NOT NULL`, though the type permits null. |
| `duration` | integer or null | Seconds; frequently null even with content. |
| `episodeArt` | string or null | |
| `explicit` | boolean | Copied from the podcast. |
| `link` | null | Always null. |
| `file.url` | string | |
| `file.length` | integer | `0` when unknown. Some feeds report placeholder lengths. |
| `file.type` | string | `"audio/mpeg"` when unknown. |

### Chart and search shapes

`TopPodcast` (`IPodcast`, produced by `getTopPodcasts` in `src/server/ingest/top.ts`) has `id`, `itunes_id` (decimal string or null), `author`, `feed`, `title`, `cover`, `thumbnail` (falls back to `cover`, so never null), `categories` (always `[]`), `explicit` and `count` (the stored episode count). Here `explicit` is the **string** `"explicit"` or `"notExplicit"`; every other route sends a boolean. The type `ExplicitState` also names `"cleaned"`, but no current serializer emits it. Decoders treat `"explicit"` as true and any other string as false, as `BoolOrString` does in `APIClient.swift`.

`SearchResult` (`IPodcastSearchResult`) has `author`, `feed`, `cover`, `title`, plus:

| Field | Presence |
| --- | --- |
| `id` | Present only when the iTunes result matches a podcast already indexed; omitted otherwise. |
| `itunes_id` | Present for text search; omitted for a private feed-URL result. |
| `thumbnail` | iTunes `artworkUrl100`; omitted if iTunes omits it. |
| `isPrivate` | Present only for feed-URL results. |

A result without `id` cannot be opened directly. The client calls `POST /api/feed/resolve` with its `itunes_id` and the locale it searched, then loads the podcast by the returned ID (`APIClient.detail(of:)`). A matched result's `feed` is the stored feed URL, not the iTunes value (`matchSearchResults` in `src/server/search.ts`), and a result whose feed is already listed is dropped, so no two results share a feed.

No current route emits `feed_url`. The `feed_url` and `count` fallbacks in the iOS `RawPodcast` decoder do not correspond to `Podcast` responses; `count` exists only on `TopPodcast`.

## Endpoints

### `GET /api/top` — public

Query: `locale` (default `us`), `limit` (parsed as an integer, clamped to 2–200, default 30; `src/app/api/top/route.ts`, `src/data/constants.ts`). Returns `TopPodcast[]` in chart order, served from Redis when every cached podcast is still public (`src/app/api/top/top.ts`). An unknown locale returns `[]`. No private-feed headers.

Each item may carry `genre` and `category`, both `{ "id": integer, "name": string }` or null: the podcast's primary Apple genre and that genre's top-level category (they are equal for a top-level genre). Both come from the chart lookup's `genreIds` (`storeGenres` in `src/server/ingest/charts.ts`). `previousRank` is the podcast's rank on the earliest stored chart day within the week before the latest one (`chart_history`), or `null` when it was not charted that day; the key is absent when no earlier day exists yet. Movement is `previousRank - index - 1`.

Fixtures: `top.us.json`, `top.nl.json` (captured), `top.explicit.json` (derived from `src/server/ingest/top.ts`; shows `itunes_id: null` and `"explicit"`).

### `POST /api/search` — optional; required for feed URLs

Body: `{ "term": string, "locale"?: string }`. The term is trimmed and must be 1–4,096 characters.

- Text: queries the iTunes Search API for `locale` (default `us`) and annotates matches with indexed IDs (`src/app/api/search/search.ts`). An iTunes failure yields `[]`, not an error.
- Feed URL (`isFeedUrlInput` in `src/shared/feed-url.ts`: starts with `http:`, `https:` or `scheme://`): requires a session. The server indexes the feed as a private podcast owned by the caller unless it is already indexed, then returns a one-item array, or `[]` if the caller cannot see it. Searching does not subscribe.

Responses carry private-feed headers.

| Status | Body | Cause |
| --- | --- | --- |
| 200 | `SearchResult[]` | |
| 400 | `{message: "A search term is required"}` | Missing, empty or over-long term |
| 400 | `{message: "Feed unavailable"}` | Invalid feed URL (`TypeError` from `feedUrl`) |
| 401 | `{message: "Sign in to open an RSS link"}` | Feed URL without a session |
| 404 | `{message: "Feed unavailable"}` | Feed fetch failed, or another user owns the private feed |
| 409 | `{message: "Feed unavailable"}` | `PodcastIdentityConflict` |

Fixtures: `search.text.json` (captured; contains results with and without `id`), `search.missing-term.json` (captured), `search.feed-url.json`, `search.empty.json`, `search.sign-in-required.json` (derived from `src/server/search.ts` and `src/app/api/search/route.ts`).

### `GET /api/search` — public

Query: `term`, `locale`. Text search only: a feed URL returns 400 `{message: "Use authenticated POST for RSS links"}`. The session is ignored, private-feed headers are only sent on that 400, and an identity conflict is not caught. Native clients use `POST`.

### `GET /api/feed?id=` — optional

Returns the full `Podcast` with every episode, or 404 `{message: "Podcast not found"}` when it does not exist or is not visible. A non-positive or non-integer `id` returns 400 `{message: "A valid podcast ID is required"}`; neither `id` nor `url` returns 400 `{message: "A podcast ID is required"}`. Before reading, `prepareEpisodeRead` rebuilds content synchronously when a podcast has episodes but no content (`src/server/ingest/episode-read.ts`), so this request can be slow. All responses carry private-feed headers.

Fixtures: `feed.id.json` (captured, episodes trimmed to three), `feed.not-found.json`, `feed.invalid-id.json` (captured), `feed.private.json` (derived from `getPodcastById`; empty episodes, null `link` and `published`).

### `GET /api/feed?url=` — public

Looks up an already-indexed **public** podcast by feed URL or public alias (`getPodcastByFeedUrl`, called without a user). It never indexes a feed and never returns a private one, even with a session. Returns `Podcast` or 404 `{message: "Podcast not found"}`.

### `POST /api/feed` — required

Body: `{ "url": string }` (at most 4,096 characters). Indexes the feed with the caller as owner if it is not already indexed, applying the same ownership rules as feed-URL search, and returns the full `Podcast`. It does not subscribe.

| Status | Body |
| --- | --- |
| 200 | `Podcast` (same shape as `feed.id.json`; `feed.private.json` shows a private result) |
| 400 | `{message: "A feed URL is required"}` |
| 401 | `{message: "Sign in to open an RSS link"}` — `feed.sign-in-required.json` |
| 404 | `{message: "Feed unavailable"}` — any fetch, validation, ownership or identity failure; `feed.unavailable.json` |

### `GET /api/feed/info?id=` — optional

Returns `PodcastInfo` (`readPodcastInfoById`): the `Podcast` fields without `episodes`, plus `episodeCount` (the stored count), `genre` and `category` (as in `GET /api/top`) and `firstPublished` (milliseconds of the earliest stored episode, or null). It has no `thumbnail`. Errors: 400 `{message: "parameter \`id\` required"}` or `{message: "parameter \`id\` must be a number"}`; 404 `{message: "podcast not found"}` (lower-case, unlike the other routes). Successful and 404 responses carry private-feed headers.

Fixtures: `feed-info.json`, `feed-info.missing-id.json` (captured), `feed-info.private.json` (derived from `readPodcastInfoById`).

### `GET /api/feed/episodes` — optional

Query (`src/app/api/feed/episodes/route.ts`, `readEpisodePage` in `src/server/ingest/episode-read.ts`):

| Parameter | Meaning |
| --- | --- |
| `podcastId` | Required canonical decimal string. |
| `limit` | Integer page size 1–200, default 20. |
| `cursor` | Nonnegative integer offset through 2147483647 from `nextCursor`; omit for the first page. |
| `sortBy` | `published` (default), `title` or `duration`; other values fall back to `published`. |
| `sortDir` | `desc` (default) or `asc`; other values fall back to `desc`. |
| `search` | At most 200 characters; case-insensitive substring match against title or show notes. |
| `unplayed` | `true` excludes episodes the signed-in account completed; ignored without a session. |

Ordering is the sort column, then episode ID in the same direction. Only `duration` sorts nulls last.

Response `EpisodePage`: `{ "episodes": Episode[], "total": integer, "hasMore": boolean, "nextCursor"?: integer }`. `total` counts all matching episodes. `nextCursor` is omitted on the last page. The cursor is a plain offset, so episodes published between page requests shift later pages; clients de-duplicate by episode `id`.

Errors: 400 `{message: "parameter \`podcastId\` required"}` or `{message: "parameter \`podcastId\` must be a number"}`; 404 `{message: "Podcast not found"}`. Successful and 404 responses carry private-feed headers.

Fixtures: `feed-episodes.first.json` and `feed-episodes.second.json` (captured; the second page follows the first page's `nextCursor`), `feed-episodes.missing-podcast-id.json` (captured), `feed-episodes.not-found.json` (derived from the route).

### `GET /api/episodes/:episodeId?podcastId=` — public

Resolves one shared episode without loading the whole catalogue (`src/server/sharing/public-episode.ts`). Both IDs are required canonical decimal strings, and the session is ignored, so only public content resolves. Response `{ "podcast": PodcastInfo, "episode": Episode }`. Errors:

- 400 `{message: "Invalid episode ID"}`.
- 404 `{message: "Episode not found"}`, whether the episode is missing, belongs to another podcast or is private.
- 503 `{message: "Episode unavailable"}`.

Success is publicly cacheable. The link format that leads here is in [the sharing contract](../sharing/README.md).

Fixtures: `episode-public.json` (derived from `feed-info.json` and the first episode of `feed-episodes.first.json`), `episode-public.not-found.json`.

### `GET /api/episodes/:episodeId/chapters` — optional (web)

Accepts an exact decimal-string **episode database ID**, never an enclosure URL.
Visibility is checked before each cache lookup or metadata fetch. An invisible or
missing episode returns 404; an invalid ID returns 400. Responses, including
errors and public episodes, carry private-feed headers.

Returns `{ "source": "embedded" | "shownotes" | "none", "chapters": [{ "title": string, "start": number }] }`.
Starts are original-source seconds, strictly increasing; a usable timeline has at
least two entries. An empty embedded title requests a localized “Chapter N” label
from the client. No enclosure URLs or artwork are returned. Metadata failures
return show-note chapters, or `source: "none"` with an empty list. Unavailable
retained episode content also returns an empty list without rebuilding the feed.
Database failures return 503 `{message: "Chapters unavailable"}`.

Native clients continue reading local media metadata; they do not consume this
endpoint. See [web chapter support](../../docs/web-chapters.md) for limits and
cache policy, and [synthetic media](../fixtures/media/README.md) for reusable
fixtures.

### `POST /api/feed/resolve` — public

Body: `{ "itunes_id": canonical decimal string, "locale"?: two-letter code }` (locale defaults to `us`; matched case-insensitively). Resolves or indexes the public podcast for an iTunes listing (`resolvePodcast` in `src/server/ingest/resolve-podcast.ts`) and returns `ResolvedPodcast` `{ "id": decimal string }`. Exact string provider responses are preserved; unsafe numeric provider responses are not guessed.

| Status | Body |
| --- | --- |
| 400 | `{message: "itunes_id must be a positive integer"}` or `{message: "locale must be a two-letter country code"}` |
| 404 | `{message: "Podcast not found"}` |
| 409 | `{message: "Unable to resolve podcast"}` — identity conflict |
| 502 | `{message: "Unable to resolve podcast"}` — any other failure |

No private-feed headers. Fixtures: `feed-resolve.resolved.json`, `feed-resolve.not-found.json`, `feed-resolve.unavailable.json` (derived from the route).

### `POST /api/feed/refresh` — optional

Body: `{ "podcastId": canonical decimal string, "onlyIfStale"?: boolean }`. Both modes call `refreshFeed(sql, podcastId)` with its default `stale` mode (`src/server/ingest/feed-refresh.ts`): the feed is fetched only if it was last polled at least 15 minutes ago (`STALE_FEED_INTERVAL`, `isRefreshDue` in `src/server/ingest/feed-schedule.ts`) and is not in a failure back-off. Neither mode forces a fetch.

With `"onlyIfStale": true`, the response is `RefreshStatus` `{ "status": string }`:

| `status` | HTTP | Meaning |
| --- | --- | --- |
| `updated` | 200 | The feed changed and episodes were stored. |
| `not_modified` | 200 | Fetched; unchanged. |
| `skipped` | 200 | Not due, or the fetched result lost its lease/source binding before publication. |
| `busy` | 202 | An active refresh lease or contended podcast write lock; retry later. |
| `not_found` | 404 | The podcast row disappeared. |
| `error` | 502 | The fetch failed; back-off was recorded. |

The web client retries `busy` with exponential back-off and refetches episode data after `updated` (`src/data/feed-refresh.ts`). Fetching runs outside database transactions, between a short lease claim and a source/owner/token-checked write phase ([details](../../docs/feed-fetching.md#refresh-transactions)). This endpoint still awaits fetching; it is not a new queued-job or freshness API.

Without `onlyIfStale`, the response is the full `Podcast` for every outcome except `not_found` and `error`, which return 500 `{message: "Failed to refresh feed"}`. `busy` and `skipped` therefore return the current stored podcast. iOS uses this mode for pull-to-refresh (`APIClient.refresh(podcastID:)`).

Errors in both modes: 400 `{message: "podcastId must be a positive integer"}`; 404 `{message: "Podcast not found"}` when not visible. Responses carry private-feed headers, except the 400 and the full-mode 500.

Fixtures: `feed-refresh.updated.json`, `feed-refresh.not-modified.json`, `feed-refresh.skipped.json`, `feed-refresh.busy.json`, `feed-refresh.not-found.json`, `feed-refresh.error.json`, `feed-refresh.failed.json`, `feed-refresh.invalid-id.json` (derived from the route).

### `GET /api/auth/session` — public

Always 200. Returns `Session`: `{ "user": null }` without a valid session, otherwise `{ "user": { "id": string, "email": string, "name": string or null, "image": string or null, "hasPasskey": boolean } }`. Fixtures: `auth-session.guest.json` (captured), `auth-session.user.json` (derived from the route and `getSession`).

### `POST /api/auth/verify` — public

Body: `{ "email": string, "code"?: string }`.

- Without `code`: replaces earlier codes for that exact email with a cryptographically generated six-digit code valid for 10 minutes. Only a keyed digest is stored; redemption is enabled only after provider acknowledgement. Returns `CodeSent` `{ "sent": true }`, or 503 `{message: "Authentication unavailable"}`. It does not reveal whether an account exists.
- With `code`: returns `Verified` `{ "verified": true }` or 400 `{message: "Invalid or expired code"}`. **A successful check consumes the code** and creates no session. A client that verifies a code here cannot then use it with `/api/auth/email-login`; native clients send the code only to `email-login`.

Missing/invalid email: 400 `{message: "Email required"}`. An explicitly supplied empty/non-string code is invalid, not a send request. Fixtures: `auth-verify.sent.json`, `auth-verify.verified.json`, `auth-verify.invalid-code.json`, `auth-verify.send-failed.json`.

Both email endpoints bound UTF-8 JSON bodies to 16 KiB and five seconds (413/408), reject malformed JSON (400), and return `Cache-Control: private, no-store` on success and errors. Codes permit five guesses, with atomic expiry/attempt/one-time checks. Sends allow one per 60 seconds and five per rolling hour per email, and 20 per rolling hour per trusted source. Verification requests allow 25/hour/email and 100/hour/source; these budgets are shared across both endpoints. Email limiter keys are case-folded without changing account identity. A 429 includes `Retry-After` in seconds. Redis, database, configuration and provider failures return a generic 503, without issuing a usable code or bypassing verification. See [email authentication](../../docs/email-authentication.md) for source trust and activation requirements.

### `POST /api/auth/email-login` — public

Body: `{ "email": string, "code": string }`. Consumes the code, creates the user if absent, and inserts a session in one database transaction; the cookie is set only after commit. Concurrent redemption produces at most one session. Returns `Verified` `{ "verified": true }`. Errors: 400 `{message: "Email and code required"}`, 400 `{message: "Invalid or expired code"}`, plus the shared limits/outages above. Email identity is compared exactly as sent: no trimming, case-folding or automatic account merges. Codes must be six-digit strings, including leading zeros. A lost success response requires a new code, not replay of the consumed code. Fixtures: `auth-email-login.verified.json`, `auth-email-login.invalid-code.json`.

### `POST /api/auth/login` — public

Start body: `{ "discoverable": true }`. Returns `PasskeyLoginStart` `{ "flowId": string, "options": PublicKeyCredentialRequestOptionsJSON }`. Options contain `rpId`, a random challenge, `allowCredentials: []`, timeout 60000 and `userVerification: "required"`. There is no email/account/passkey discovery response; clients offer email-code login independently. A missing start discriminator returns 400 `{message: "Passkey flow required"}`. Fixtures: `auth-login.discoverable.json`, `auth-login.missing-flow.json`.

`flowId` is a server-issued 256-bit opaque base64url value. Shared Redis storage expires it after five minutes and atomically consumes it before verification, including failed verification. Start and finish can reach different processes. Flows bind purpose; registration additionally binds account and issuing session. A failed/cancelled/expired flow requires new options. Issuance allows 20/hour/trusted source; verification shares the authentication source budget. Redis/configuration outages fail closed with 503.

Verification body: `{flowId, response}`, where `response` is `AuthenticationResponseJSON`. The server derives identity from the credential, requires user verification and the unchanged accepted RP/origin set ([native associations](../../src/server/auth/native-apps.ts)), serializes credential counter changes, and creates a session in the same transaction. Success returns `PasskeyLoginResult` `{ "verified": true, "userId": string }` (`auth-login.verified.json`). Bad credentials/origin/RP/signature return generic 400 `{message: "Passkey verification failed"}`. Missing, replayed, expired or misbound flows return 400 `{message: "Invalid or expired passkey flow"}` (`auth-login.challenge-expired.json`).

### `POST /api/auth/register` — required

Adds a passkey to the signed-in account. Start body: `{}`. A session is required (401 `{message: "Authentication required"}`). Identity and email come only from that session.

- Start returns `PasskeyRegistrationStart` `{flowId, options}`, from `generateRegistrationOptions`: `challenge`, `rp: {name: "Podcst", id}`, `user: {id: base64url(UTF-8 user ID), name: email, displayName: ""}`, `pubKeyCredParams` for algorithms −8, −7 and −257, timeout 60000, `attestation: "none"`, existing `excludeCredentials`, `authenticatorSelection: {residentKey: "required", userVerification: "required", requireResidentKey: true}`, `extensions: {credProps: true}` and `hints: []`.
- Finish body: `{flowId, response: RegistrationResponseJSON}`. The flow must match both account and session. The session is rechecked under lock before insertion, so revocation during the platform prompt refuses registration. Returns `PasskeyRegistrationResult` `{ "verified": true }`.

Web, iOS AuthenticationServices and Android Credential Manager implement this flow. Native clients fence prompt results against account changes and do not submit cancelled prompts. Error/cache/limiter semantics match passkey login. Fixtures: `auth-register.options.json`, `auth-register.verified.json`, `auth-register.unauthenticated.json`.

### `POST /api/auth/logout` — public

Deletes the session if present and clears the cookie. Does not depend on Redis. On success returns `Success` `{ "success": true }` (`auth-logout.success.json`).

### `GET /api/subscriptions` — required

Without a view, returns hydrated `Podcast[]` previews, newest subscription first,
with at most two episodes per show. These previews are not membership truth.
`view=membership` returns the complete scoped `FollowSnapshot` from the
[state schema](../state/schema.json), including unavailable owned references without
private metadata. Duplicate/unknown query parameters are rejected. Failed reads
never represent an empty library. Fixtures: `subscriptions.list.json`,
`subscriptions.unauthorized.json`, `follow-state.membership.json`.

### `POST /api/subscriptions` — required

Accepts `FollowBatch` and returns `FollowAcknowledgement`: scoped, sequenced desired
`{podcastId, followed}` actions, never toggles or cache replacement. Effects,
revisions and acknowledgements commit together; identical replay does not reapply.
See [durable state](../state/README.md) for ordering, errors and limits. Fixtures:
`follow-changes.accepted.json`, `follow-changes.partial.json`.

Unversioned one-item writers and `DELETE /api/subscriptions` return 426
`update_required`. Unfollow is an ordinary `followed:false` action.

### `POST /api/subscriptions/resolve` — required

Body: durable scope plus `feedUrls`, 1–20 strings of at most 4096 characters,
within 64 KiB of encoded UTF-8. Returns the same scope and one ordered item/input:
`{index, podcastId:string|null, status:"resolved"|"retry"|"unavailable", retryAfterSeconds:number|null}`.
Only resolved items have IDs; only retry items have a positive bounded retry delay.
Unsafe/invalid/hidden/conflicting sources are unavailable. Temporary upstream,
admission and deadline failures are retryable, including inputs not yet started.
Duplicate normalized locators share work without dropping their input positions.

This resolves identities, never membership. All clients persist successful results
as ordinary follow intents and retain other inputs. Retry deadlines survive local
restart/account departure. Batches respect both item and byte limits. New pending
imports are capped at 1000/account; older larger sets remain available for bounded
retry instead of being discarded. This is not an asynchronous import-job API.

The existing safe indexer uses two workers and one ten-second upstream deadline.
Shared admission allows six new-work requests/account/minute, 120 starts/minute,
two active imports/account and 16 globally. Already indexed sources need no fetch
permit. Redis failure refuses new fetching without hiding cached authorized results.
The initiating session, account and recovery generation are rechecked at commit
and before returning the batch; revocation cancels/drains sibling work. Private
identity ownership is rechecked after fetching. Fixture: `follow-resolution.result.json`.
See the [feed contract](../feeds/README.md) for exact shapes and limits.

### `GET /api/progress` — required

Presentation reads remain: no query returns `{position, episode}` or `null` for the
latest playable incomplete row, ordered by accepted revision; `recent=1..10` returns
such rows; `episodeIds` (1–200 distinct decimal strings) or `podcastId` returns
`{episodeId:string, position, completed}` rows. These presentation responses do not
acknowledge pending work.

`view=state` with exactly one of `episodeIds` or `recent` returns a scoped
`ProgressSnapshot`. Explicit-ID reads include every requested ID with nullable
`progress`; `recent=1` also bootstraps account/generation when no episode qualifies.
Only same-scope, sufficiently new state snapshots can retire acknowledged overlays.
Unknown/duplicate query parameters and incompatible selections are rejected.
Fixtures: `progress.empty.json`, `progress.current.json`,
`progress-state.episodes.json`, `progress-state.empty.json`.

### `PUT /api/progress` — required

Accepts `ProgressBatch` and returns `ProgressAcknowledgement`. Each desired action
requires `{episodeId, positionSeconds, completed}`. `completed:null` is a position-only
checkpoint that preserves server completion; explicit true/false sets or clears it.
Snapshot completion is always boolean. Seconds are whole original-source seconds
in `0..2147483647`, not percentages or playback-rate-adjusted time. Ended or manual
played completes; unplayed resets to zero; deliberate replay clears completion.
An identical retry never becomes a new action or latest-playback promotion.
Unversioned writers return 426, malformed actions 400, and inaccessible identities
an ordered `not_found` result. Fixtures: `progress-changes.accepted.json`,
`progress-changes.invalid.json`, `progress-changes.recovery.json`.

### `GET /api/search/episodes?term=` — public

Searches episode titles of public podcasts whose episode content is stored (`searchEpisodes` in `src/server/search.ts`). Words are reduced to letters and numbers and matched as English prefixes (`prefixQuery`), so `field` also matches `fields`; at most 1,000 matches are ranked, by title rank then newest. Returns up to 20 `Episode` objects with `podcastId` and `podcastTitle`, cacheable for five minutes. Feed URLs, empty terms and terms over 200 characters return 400 `{message: "A search term is required"}`.

### `GET /api/noteworthy` — public

Query: `locale` (default `us`) and optional `category`, a top-level genre ID. Returns up to 14 `TopPodcast` items from that region's chart, each with `firstPublished`: shows whose first stored episode is at most 180 days old, newest debut first, then charted shows below rank 30 in rank order (`noteworthy` in `src/server/discover.ts`). 400 `{message: "parameter \`category\` must be an integer"}`.

### `GET /api/feed/related?id=` — public

Returns up to four public `TopPodcast` items: podcasts at least three subscribers of `id` also follow, by shared listeners, then shows of the same top-level category from the `locale` chart in rank order (`related` in `src/server/discover.ts`). Private podcasts return 404 `{message: "Podcast not found"}`; 400 `{message: "parameter \`id\` must be a positive integer"}`.

All clients consume per-episode progress and preserve current/recent reconciliation.
Shared state-read and mutation fixtures are indexed for both native transports. The
[durable state contract](../state/README.md) defines persistence, generation fencing,
exact identities and retry behavior. Catalogue extensions remain separate from
membership/progress truth.

### `GET /api/account` — required

Returns `Account`: `{ "createdAt": ISO-8601 string or null, "passkeys": AccountPasskey[], "preferences": Preferences }` with private-feed headers (`getAccount` in `src/server/account.ts`). `AccountPasskey` is `{ "id": string, "provider": string or null, "createdAt": ISO-8601 string, "lastUsedAt": ISO-8601 string or null }`, ordered by creation. `provider` names the credential manager from the registration AAGUID (`src/server/auth/passkey-providers.ts`) and is null for unknown or unrecorded authenticators; `lastUsedAt` is set by each successful passkey sign-in. `Preferences` is `{ "speed": number, "volumeBoost": boolean, "trimSilence": boolean }`: the account's global audio defaults from the [preference rules](../playback/README.md#preferencesjson), or `null` until the account first saves them. A signed-in client adopts non-null server defaults and uploads its own defaults when the value is `null`. 401 `{message: "Unauthorized"}`.

### `PUT /api/account/preferences` — required

Body: `Preferences`. Every field is required; `speed` must be one of `rules.json` `speeds.supported` (`parsePreferences` in `src/shared/preferences.ts`). Replaces the stored defaults and returns them with private-feed headers. 400 `{message: "speed, volumeBoost and trimSilence required"}`, 401 `{message: "Unauthorized"}`. Per-podcast overrides are not stored on the server.

### `DELETE /api/account/passkeys/:id` — required

Removes one of the account's passkeys. Returns `Success`, 404 `{message: "Passkey not found"}` for an unknown ID or another account's passkey, 401 `{message: "Unauthorized"}`. Removing the last passkey leaves email-code sign-in.

Fixtures (derived from the routes): `account.details.json`, `account.unsaved.json`, `account.unauthorized.json`, `account-preferences.saved.json`, `account-preferences.invalid.json`, `account-passkey-remove.success.json`, `account-passkey-remove.not-found.json`.

### `GET /api/lists` — required

Bootstraps the account's built-in Starred list and returns durable scope plus
`{ "lists": EpisodeList[] }`.
`EpisodeList` contains UUID `id`, `kind` (`starred` or `playlist`), nullable `name`,
decimal-string `revision` and integer `itemCount`. Starred has no stored name;
clients localize it by kind. Count includes unavailable memberships. There is no
playlist creation endpoint yet.

All list responses, including errors, carry private-feed headers. Missing
sessions return 401; nonexistent and other accounts' lists both return 404.
Uncaught session/database failures return private 503 `unavailable`.

### `GET /api/lists/:id/items` — required

`view=membership` returns `ListSnapshot`: durable scope plus `{ "listId": UUID,
"revision": string, "items": ListMembership[] }`. This is the **complete** account-owned membership
snapshot, never a page. `limit` and `cursor` are rejected in this view.

`ListMembership` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `episodeId` | decimal string | Canonical episode database ID. |
| `addedAt` | integer | Server addition time in epoch milliseconds. |
| `availability` | string | `available`, `content_missing` or `unavailable`. |

`view=episodes` (default) returns `ListEpisodePage`: the same envelope and entry
fields, with `episode: Episode | null` per item and `nextCursor: string | null`.
Limit defaults to 100 and must be 1–200. The opaque keyset cursor belongs to that
list; ordering is addition time then episode ID, descending. Concurrent changes
can move items between display pages, so deduplicate by ID. Never infer removals
from display pagination: the complete membership snapshot is authoritative.

Missing or revoked content does not delete a membership. Inaccessible private
metadata is never returned; clients must purge cached private data for
`unavailable` entries. Revisions track membership/list changes, not episode
metadata or access changes. Recheck availability even at an unchanged revision.

Invalid UUIDs, views, duplicate/unknown query parameters, limits and cursors return
400 `{message: ...}`. The endpoint does not wait for upstream feeds. Missing
content schedules best-effort recovery after the response: at most three feeds,
with a 15-minute per-feed throttle and existing failure backoff. A saved episode's
retained content is excluded from eviction without subscribing to its podcast.

### `POST /api/lists/:id/changes` — required

Body `ListBatch`: durable scope plus `{ "clientId": UUID, "sequence": decimal
string, "changes": [{ "op": "add" | "remove", "episodeId": decimal string }] }`.
There must be 1–100 actions and at most 64 KiB of request body. Extra body/action
fields are rejected. Sequence ranges from 1 through the signed PostgreSQL bigint
maximum, encoded as a string so it survives JavaScript decoding exactly.

Actions are ordered. Add requires a visible episode identity, not necessarily
retained content; adding an existing member preserves its time. Remove physically
deletes the membership and succeeds as a no-op when absent, including for an
unknown ID. It can remove an owned membership whose episode is now inaccessible.
No toggle, whole-list replacement, import or source/GUID resolver exists.

Returns `ListAcknowledgement`: durable scope plus `{ "clientId", "sequence",
"listId", "revision", "results": [{ "episodeId", "status": "applied" |
"unchanged" | "not_found" }] }`.
Results correspond to actions in order. `not_found` covers missing and
inaccessible adds. Terminal per-action failures can coexist with successful
ones; the batch effects and its acknowledgement commit together. Revision advances
once when any action changes membership, not for an entirely no-op batch.

Each client/account stream starts at 1, sends one batch at a time and persists
its exact in-flight batch. The immediately preceding sequence with the same
canonical request returns its saved acknowledgement **without replaying actions**.
Older, skipped or changed-payload sequences return 409. A saved acknowledgement
is not a current snapshot: refetch membership after acknowledging a batch.
Explicit actions on different devices use last server-accepted action wins.

400 covers malformed input, 413 oversized bodies, 426 unsupported protocol, and
409 account/generation/stream conflicts. Scope checks precede replay. Mutation
requests share a 120/account/minute budget across lists, progress and follows;
new stream registrations share a 20/account/hour budget. Limits return 429 with `Retry-After: 60`;
Redis failures fail closed with 503. Retry transient failures with the identical
batch. Do not retry a protocol 409 under a new sequence or client ID.

Fixtures derived from `src/server/lists/service.ts` and `response.ts`:
`lists.list.json`, `lists.unauthorized.json`, `list-items.membership.json`,
`list-items.episodes.json`, `list-changes.accepted.json`,
`list-changes.conflict.json`. Both native transports decode these fixtures.
Web, iOS and Android implement durable outboxes and run the shared
[offline transition vectors](../fixtures/sync/star-outbox.json). See the
[episode-list design](../../docs/episode-lists.md) for guest transfer and rollout.

### `POST /api/lists/:id/migration` — required

The one-time bridge accepts durable scope plus `batch`, containing the unchanged
old `{clientId, sequence, changes:[{op, episodeId:number}]}` request. Only positive
safe numeric IDs from the old protocol are accepted here. The server keeps the old
numeric request hash and acknowledgement in its ledger, and returns a normalized
scoped/string-ID acknowledgement. Both accepted and unaccepted old flights keep
their original sequence; this is not a new intent or an ongoing legacy writer API.
The bridge refuses work after a recovery-generation rotation. Fixture:
`list-migration.accepted.json`; preservation cases live in the state/list tests.

## Fixtures

Captured fixtures are produced by [`contracts/scripts/capture-api-fixtures.ts`](../scripts/capture-api-fixtures.ts):

```sh
bun contracts/scripts/capture-api-fixtures.ts
```

The script only sends unauthenticated requests that do not change user data, to `https://www.podcst.app` or `PODCST_API_ORIGIN`. It trims arrays to a few items (keeping both resolved and unresolved search results), keeps show notes intact up to 8 KiB and cuts longer notes at a paragraph boundary, writes two-space JSON, updates the index entries it owns and fails if the index and the directory disagree. Values change as the catalogue changes; the shape and file set do not.

Every other fixture is hand-authored from the serializer named in its section above, with the same key order, types and nullability. Their IDs, emails, credentials and challenges are synthetic. Clients decode every file listed in the index as its `decodesAs` type and must also tolerate unknown keys.

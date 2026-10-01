# Public and private podcast ownership

Entry point: [Release hub](release.md). This document owns the public/private policy, access boundary and rollout requirements. The owner approved this two-state scope; quarantine and a general alias system are not prerequisites for this slice.

Status: implemented in `e8ab35c` and locally verified on the feature branch, not deployed. Feed-HTML hardening is recorded separately in `be8e18b`. Existing-data review and coordinated production cutover remain required.

## One privacy field

`podcasts.owner_user_id` is the single source of truth:

| Value | Meaning | Read access |
| --- | --- | --- |
| `NULL` | Public source | Anyone |
| User ID | Private source | That user only |

There is no stored `is_private` flag to drift out of sync. Client `isPrivate` fields are derived projections, not authorization inputs. A private record cannot have an `itunes_id`; verified promotion clears ownership and sets that identity atomically. Deleting an owner cascades to their private sources rather than accidentally making them public.

Ownership is not inferred from subscriptions. Unfollowing removes a subscription, not source ownership or another user's access policy.

## Authenticated URL search

Both iOS and web require a login session for URL search, including URLs already indexed publicly. Clients send the URL in a JSON request body, not a search query string. Ordinary text discovery remains available without login.

For an authenticated URL request:

1. An indexed public source is reused as public.
2. An indexed private source owned by this user is reused privately.
3. An indexed private source owned by another user is unavailable. It is not exposed, reassigned or duplicated for the caller.
4. A previously unindexed valid HTTP(S) URL is fetched and created with the session user as owner. Client-supplied ownership, privacy and provider-ID fields have no authority.

This slice retains one indexed record per exact feed URL. Multiple owners' private copies of the same locator are deliberately not introduced. Fetching a new feed occurs outside the database write transaction; identity locks and a second lookup settle concurrent imports before mutation. Concurrent fetches may occur, but only one owner/identity wins.

The search route accepts private URL imports through authenticated POST. The feed POST supports the same policy for client detail/OPML flows. The old GET-by-URL path only reads already-indexed public records; it never imports or returns private data. Page rendering and metadata generation no longer ingest arbitrary URLs.

Searching/importing does not automatically follow a source. Subscribe remains a separate action.

## Verified public promotion

A trusted Apple lookup/chart result must associate a valid `itunes_id` with the **same complete stored feed URL** before a private record is promoted. Do not strip credential/query parameters, infer equivalence from a title, or trust an ID supplied alongside a client's URL.

Promotion updates the existing podcast row in place. Podcast/episode IDs, subscriptions and playback progress remain unchanged. If provider and URL evidence identify different existing records, fail with an identity conflict rather than silently merging or publishing either one.

The Podcast Index bulk importer skips private candidates without an Apple ID. When a private exact-URL candidate has an ID hint, it uses the trusted lookup path; an unverified or different-source result does not clear ownership. Ordinary bulk updates are restricted to public rows. The [alias-resolution plan](feed-identity-resolution-plan.md) remains follow-up work for verified moves and conflicting identities, not permission to weaken this boundary.

## Access and cache boundary

- Source/episode reads authorize through the parent podcast before returning content or initiating read-triggered refresh.
- Private API responses use `private, no-store`; account/session identity is not inferred from a cached response.
- Shared feed-cache data cannot bypass ownership: the feed route no longer reads or writes that legacy URL-keyed cache.
- Public chart-cache hits are rechecked against current public source IDs and locators before being served.
- Subscription and progress reads/writes enforce source access. Adding a reference to a private ID does not grant access; even an invalid existing reference cannot expose it.
- Public metadata and structured-data generation never use owner-authorized private content. Legacy short links resolve only through public sources and redirect to canonical IDs, not credential-bearing URLs.
- Both clients suppress private-source sharing. Private artwork is fetched directly rather than generated through the shared artwork proxy/fallback.
- Web account changes cancel/clear query state and replace the document; private records cannot be written into the guest subscription store. Native search is account-scoped and discards stale results; existing account-scoped media/session retirement remains in use.
- Feed descriptions/show notes are sanitized with an allowlist before rendering. Timestamp/link enrichment is restricted to text and sanitized again, so untrusted feed HTML cannot execute as the signed-in reader.

Server locators remain in the existing database column in this slice; no new field-level encryption scheme is claimed. Restrict database access and protect encrypted backups/operational artifacts. Authorized clients still receive source/media URLs required for their own listening/export workflows. Never put these into public previews, shared cache keys or raw error diagnostics.

## Existing records and rollout

Adding a nullable owner column does **not** determine who created older URL imports. Existing indexed records retain their prior public behavior until separately reviewed. This change does not claim to remediate historical private-feed exposure or classify sources merely because they lack directory IDs.

Before deploying private imports:

1. Complete the applicable R1 adoption/recovery steps against the reviewed starting state.
2. Review existing credential-bearing sources and approve any ownership backfill explicitly. Do not choose a sole/earliest subscriber as owner automatically. Unresolved legacy classification is an operational decision, not a new quarantine state hidden in the schema.
3. Apply the append-only ownership migration, then coordinate compatible backend, web/iOS, catalog-writer and backup revisions. The identity backup now includes `owner_user_id`; older identity formats do not prove ownership. Restore only a reviewed coherent set and fail closed on missing ownership/parent evidence—never default a missing private owner to public. Old readers as well as writers must lose database access; an obsolete preview/Fly/Vercel deployment can bypass new application-level checks.
4. Restrict/invalidate only affected legacy feed, chart, short-link, proxy and client caches where historical private data was exposed. Do not globally flush unrelated caches or mutate real records from test fixtures.
5. Verify anonymous/owner/other-account behavior on the deployed candidate before enabling the release promise. New imports are private by default; full private-feed safety also depends on the separate safe-fetch/egress and recovery gates.

Keep inventories, raw locators, account mappings, backups and execution receipts outside Git in protected operational storage. The [read-only catalog](../scripts/audit-private-feeds.sql) and [reference](../scripts/audit-private-feed-references.sql) audit helpers remain investigation tools, not classification or mutation authority.

## Acceptance evidence

Automated tests cover owner-only creation/reuse, rejection of other accounts, concurrent ownership claims, public reuse, exact verified promotion with stable IDs/progress, conflicting identities, credential-bearing URL differences, chart promotion, private refresh artwork and owner deletion.

An isolated subprocess exercises the actual API handlers and datastore against disposable PostgreSQL: guest URL rejection, ignored client privacy/owner assertions, owner reads, anonymous/other-account denial, refresh denial, stale chart/short-link boundaries, subscriptions/progress and invalid stored references. It binds the test database to an operator-owned temporary cluster and never uses application production settings.

Native tests cover JSON-body URL search/import, session credential forwarding, decoded privacy, disabled private sharing, guest-library exclusion and existing account/cache retirement. Web tests cover safe feed HTML and image handling. Verification: **273 Bun tests passed**, **28 unrelated platform/SSR tests skipped**, **32 targeted iOS simulator session/cache tests passed**, TypeScript passed, and the production web build passed against disposable PostgreSQL/Redis. An actual local Next server smoke check also passed real-cookie owner/other/anonymous API access, private SSR/noindex/no-store, and public access. Biome checks pass with existing warnings in touched legacy code. These are implementation checks, not a production migration, actual legacy classification or physical-device release sign-off.

# Foundations to settle before the public release

Entry point: [Release hub](release.md). This document owns foundational contracts and architecture choices; execution order and current focus live in the hub.

Use the pre-release breaking-change window to establish ownership, identity, mutation and persistence contracts. Keep the stack and useful audio work. Breaking compatibility does not authorize discarding user data.

## 1. Make source ownership explicit

Separate public catalog sources from private, owner-authorized sources. A private feed is not merely a public record whose URL contains a secret.

Keep stable podcast/episode identity separate from the current fetch locator. Private-source credentials, caches and derived resources inherit the owner's access boundary. Public catalog DTOs and authenticated playback/library DTOs should be separate projections rather than raw ingestion records.

An owned podcast record plus protected locator storage can establish this boundary within the existing application. A separate catalog service or private episode database is not required.

## 2. Use one stable identity scheme

Use durable Podcst podcast/episode IDs across clients, queues, caches and synchronization. Scope publisher GUIDs to their source; feed URLs, provider IDs and GUIDs are not interchangeable primary keys. Implement the [shared alias-aware resolver](feed-identity-resolution-plan.md) across all ingestion paths so verified historical and current locators converge without unsafe cross-owner merges.

Model unresolved discovery/import records separately. If offline provisional entities are supported, give them explicit local identities and a resolution mapping instead of spreading optional-ID fallbacks throughout the product.

Keep PostgreSQL bigint keys and expose them as opaque strings with typed client wrappers. Preserve exact values at the database-driver boundary rather than converting through potentially lossy JavaScript numbers. There is no need for a whole-catalog UUID migration.

Episode identity and media representation are distinct. Credential rotation, replaced enclosures and dynamic ads must not silently change library identity. Representation checks can detect changed media but do not automatically align different timelines.

## 3. Define a checked cross-client API contract

Use one machine-readable contract, preferably OpenAPI, for generated transport DTOs and request/response validation. Keep UI/domain models platform-specific. Test server responses and shared payload fixtures in both clients; generation alone is not verification.

Settle these rules once:

- String IDs, explicit nullability, one timestamp representation and clearly named units.
- Distinct discovery, metadata, library-state and authorized playback resources.
- Bounded lists with stable cursor ordering.
- Machine-readable errors, conflicts and actionable retry behavior.
- Per-item import outcomes so partial failures can be retried safely.
- Explicit authorization and public/private exposure for every resource.

Replace prototype payloads and update both clients together before release. After release, document the minimum supported client/protocol and an explicit update-required path.

## 4. Make user-state mutations transactional

Progress, completion, follows and saved membership need explicit resources and commands. Use revisions, stable mutation IDs, desired-state operations and transactional deduplication. Version progress and membership independently.

Use transactional local storage for mutable library state: SQLite on iOS and IndexedDB transactions on web are suitable. Persist each local change and its pending outbox entry atomically; retain the entry until acknowledgement. Audio files and disposable artwork caches need not move into the same database.

Define guest merge, conflict, logout and account-switch behavior before adding more stores. Never use furthest position or client-clock order as the general conflict rule: intentional rewind and relisten must remain possible. Keep queues and downloaded-file state device-local initially.

A paginated snapshot plus revisioned mutations is sufficient to start. Event sourcing, CRDTs, realtime synchronization and an external queue vendor are not prerequisites.

## 5. Separate saved state from disposable content

Preserve stable identity, necessary parent context and last-known metadata for saved episodes. Derive retention from live references rather than introducing an independent pinned-state truth.

Support partial content availability and honest unavailable states. Keeping one saved item does not imply retaining every episode in its show, polling that show more often, or archiving publisher audio indefinitely.

Follow, queue, download and playlist state can share presentation components without becoming one generic list engine. Their ownership, ordering and lifecycle rules differ.

## 6. Bound ingestion independently of interactive reads

Metadata reads should return cached data with explicit freshness or pending status rather than unpredictably waiting for a publisher inside a long database transaction.

Use bounded durable refresh work with leases, retries and worker-death recovery. Fetch outside the write transaction, then validate the lease/generation before committing. Preserve exclusion and backoff guarantees.

The existing application, PostgreSQL and worker process are adequate foundations. Use set-based, bounded library queries before introducing additional infrastructure.

## 7. Separate playback intent from transport

Define explicit play, pause, stop, seek, ended and failed commands/events. Queue mutation, completion and persistence should not be incidental consequences of setting a generic transport state.

Make transitions deterministic and transport side effects separate. Share behavioral fixtures across clients rather than forcing a shared Swift/TypeScript implementation. Preserve native transport abstractions and judge audio implementations through device tests.

## 8. Treat migrations as an audited mechanism

Track applied migrations with checksums and exclusive execution locking. Apply transactionally where supported and declare exceptions explicitly. Reconcile live/manual schema history before establishing a baseline.

Ordered migrations should be authoritative; derive schema snapshots rather than maintaining competing definitions. Test empty-database creation and upgrades from representative existing snapshots. Rehearse large rewrites and recovery before deployment.

For a coordinated breaking cutover, pause obsolete writers, verify a protected backup, migrate, deploy both clients and reject unsafe old protocol writes. Preserve stable IDs and user state; invalidate only rebuildable caches. Do not keep permanent compatibility layers for prototype contracts unnecessarily.

## Order and non-goals

Follow the [release hub's execution sequence](release.md#execution-sequence). The numbered sections above group architecture topics; they are not a separate ordered backlog.

Do not turn this into a framework migration, database replacement, audio rewrite, generic playlist platform, microservice split or broad repository reorganization. The goal is to remove ambiguity from planned features, not build a separate platform.

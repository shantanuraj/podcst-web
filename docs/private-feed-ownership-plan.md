# Private-feed ownership design

Status: proposed architecture and rollout requirements. This document contains no production inventory, account mapping, incident record or migration target list.

## Ownership model

Attach `owner_user_id` and explicit visibility to the podcast/source boundary. Do not infer ownership from subscriptions, and do not attach an owner to every public catalog show.

| Visibility | Owner | Read policy | Refresh policy |
| --- | --- | --- | --- |
| `public` | None | Public catalog projections | Trusted public-source ingestion and normal polling |
| `private` | Required | Owner only, including episodes and derived metadata | Authenticated import and authorized private-source polling |
| `quarantined` | Unassigned during initial classification | No ordinary client access | No refresh until reviewed |

Enforce visibility/owner consistency. Quarantine is an access decision, not simply an inactive scheduling flag. If owned sources need suspension later, model that without losing ownership.

Store private locators encrypted behind a restricted secret-storage boundary. Use an HMAC-based fingerprint for owner-scoped source deduplication instead of raw credential-bearing URLs in globally shared keys. Keep the owner in one place and derive episode authorization through the source relationship.

Public-source uniqueness and private `(owner, source)` uniqueness have different scopes. Public imports must not merge into, promote or overwrite private/quarantined records through provider-ID or URL matching.

Preserve stable podcast/episode IDs when ownership is established. A separate episode catalog or proxying all publisher audio through the application is not required.

## Import and lifecycle semantics

- Require sign-in for server-owned private feeds. Guest private listening, if offered, needs an explicit device-local design.
- Treat arbitrary submitted URLs as private unless independently established public provenance is available. Do not let an untrusted caller mark a source public.
- Receive credential-bearing locators in authenticated request bodies, not public navigation URLs. Exclude them from logs, traces and request-body capture.
- Deduplicate within an owner. Another account must supply its own authorized source and must not gain access by subscribing to an existing private ID.
- Keep a private feed separate from its public counterpart; matching titles or GUIDs do not justify merging bonus content into the public catalog.
- Unfollowing, removing a private source and deleting an account are separate operations. Define their effects on downloads, pending mutations, backups and provider credentials.
- Credential rotation changes the locator, not library identity.
- Authorized clients may receive publisher media URLs when necessary for playback, but those responses must not enter shared caches, previews or analytics.

## Existing-data classification

Perform inventory and ownership review in a protected operational environment. Do not commit raw results, source locators, user identifiers, personalized titles, backups or database snapshots.

URL patterns and provider families are candidate signals, not classification or authorization rules. A missing directory ID does not prove privacy, and a directory ID does not prove that the current locator is safe to expose. Public hosts often use opaque path identifiers.

Use trusted provenance and explicit owner confirmation. A sole or earliest subscriber is only an investigation lead, not ownership proof. Include playback-only and guest/unsubscribed cases where evidence is available.

Classify each reviewed source as verified public, confirmed private with an owner, or quarantined. Keep the mapping to real records outside Git. Resolve public duplicates separately, preserving references and choosing canonical metadata deliberately; do not collapse episodes by title or silently discard conflicting user state.

Where credentials may have been exposed, ownership confirmation alone does not remediate that exposure. Review rotation, retained copies and any notification obligations through the appropriate private process.

## Authorization boundary

Use a central server-only access service with an explicit actor or public projection. Apply checks before database/cache reads, rendering and refresh—not only in the UI.

| Surface | Requirement |
| --- | --- |
| Feed/episode lookup, search and refresh | Authenticate/authorize private resources; avoid disclosing their existence to other users |
| Pages, metadata, previews, links and redirects | Public output contains only public resources; private navigation uses opaque IDs |
| Subscriptions, progress and saved membership | Referencing an episode or following a source never creates authorization |
| Shared caches | Public resources only; private responses initially favor `private, no-store`, with scoped caches only where justified |
| Artwork, chapters, transcripts and notes | Inherit source visibility; avoid public proxy URLs containing credentials |
| Importers and workers | Explicit trusted authority, no quarantine bypass exposed to clients, and no secret-bearing diagnostics |
| Client persistence | Owner-scoped state and media; defined logout/account-switch cleanup |
| Deletion and restore | Restore preserves ownership and reapplies deletion/quarantine decisions |

## Rollout requirements

1. Establish migration safety and prepare a protected inventory/classification process.
2. Add visibility, owner, protected locator storage and consistency constraints.
3. Cover every read, mutation, cache and worker path with authorization tests.
4. Introduce authenticated owner-scoped imports and safe bounded fetching.
5. Apply a reviewed, private backfill mapping; preserve or explicitly reconcile existing identities and references.
6. Coordinate clients and server, reject unsafe obsolete contracts, and invalidate affected caches without globally flushing unrelated data.
7. Verify access, offline account isolation, deletion and recovery before enabling the release promise.

A database column alone is not containment. Production mutation requires a reviewed target set, protected backup, concurrency handling, explicit conflict policy and postcondition checks. Environment-specific repair scripts and execution receipts belong outside the public repository.

## Acceptance tests

- Anonymous, owner and other-account requests exercise IDs, URL lookup, metadata, redirects, warmed caches and refresh.
- A non-owner cannot gain access by subscribing, saving progress or adding an episode to a list.
- Concurrent/repeated imports are idempotent within an owner and isolated between owners.
- Public importers cannot overwrite private records or promote quarantine.
- Locator rotation preserves episode identity and invalidates obsolete cache entries.
- Offline logout/account switch cannot expose another account's files or replay its pending mutations.
- Ambiguous legacy records fail closed rather than receiving a guessed owner.
- Backups restore ownership and deletion/quarantine semantics; missing decryption keys fail closed.
- Logging/error/test fixtures contain no real private URLs, credentials, account identifiers or payloads.

## Read-only inventory helpers

The repository includes generic queries, not their operational output:

- [Catalog signal audit](../scripts/audit-private-feeds.sql): aggregates bounded primary-key ranges; defaults to `(0, 100000]` and rejects wider batches.
- [User-reference audit](../scripts/audit-private-feed-references.sql): returns aggregate reference counts and temporary labels, not account IDs or raw locators.

Use an explicitly selected database and preferably a dedicated read-only role. Both queries declare read-only transactions and statement/lock timeouts. For example, with connection settings supplied securely through the environment:

```bash
psql -X -qAt -v ON_ERROR_STOP=1 -v min_id=0 -v max_id=100000 \
  -f scripts/audit-private-feeds.sql

psql -X -qAt -v ON_ERROR_STOP=1 \
  -f scripts/audit-private-feed-references.sql
```

Treat even aggregate outputs as private operational data. Review output before sharing; do not check it into Git or put it in public CI artifacts. These heuristics intentionally do not assign owners, mutate data, prove a source public/private or certify the absence of exposed credentials.

# Alias-aware feed identity resolution

Status: implementation plan; no migration or application change is implied by this document.

Entry point: [Release hub](release.md).

This plan owns alias keys, canonical selection, concurrent ingestion and duplicate-record reconciliation. It consumes the ownership plan's [scope and credential-storage contract](private-feed-ownership-plan.md#ownership-model), [authorization boundary](private-feed-ownership-plan.md#authorization-boundary) and [existing-data classification](private-feed-ownership-plan.md#existing-data-classification).

Examples are synthetic. Operational evidence follows the ownership plan's protected-data rules.

## Problem and scope

Exact-key deduplication and source identity resolution are different responsibilities. A unique feed URL prevents duplicate rows for that string; a unique provider ID helps only when the caller supplies or verifies that ID. Neither establishes that historical and current URLs belong to one source.

A synthetic example is:

```text
http://feeds.example.org/show.xml
https://feeds.example.org/show.xml
https://publisher.example.net/current.xml
```

These must converge when verified identity evidence connects them, not merely because their titles or episodes look alike. HTTP fetching, choosing a canonical locator and reconciling existing records are separate operations.

Goals:

- Preserve stable podcast and episode identities across verified feed moves.
- Make different ingestion entry points follow the same identity policy.
- Prevent concurrent imports of known aliases from creating separate sources.
- Surface conflicting existing identities instead of silently choosing one.
- Preserve owner isolation and credential semantics for private feeds.

Non-goals: fuzzy title matching, globally unique episode GUIDs, automatic merging of arbitrary mirrors, a whole-catalog rekey, or a new ingestion service. Not every pair of similar feeds can be safely resolved automatically.

## Invariants

1. One accepted locator alias maps to at most one source within its authorization scope.
2. A source has one authoritative canonical fetch locator, independent of its stable ID and historical aliases.
3. A provider ID is identity evidence only when obtained through a trusted provider path; callers cannot assert arbitrary associations.
4. Alias claims and source associations preserve the [ownership model's scopes](private-feed-ownership-plan.md#ownership-model), even when content or locators match.
5. A redirect or feed hint does not itself grant access, change ownership or authorize deleting another source.
6. A conflict between established identities requires reconciliation; ordinary lookup/import must not silently merge user state.
7. Alias claims, source creation and provider association are transactional. Retries cannot leave partial identities or duplicate claims.

## Identity data

Add alias mappings to the [existing source boundary](private-feed-ownership-plan.md#ownership-model), rather than defining a parallel catalog or a second ownership model.

Logical records:

| Record | Responsibility |
| --- | --- |
| Source | Stable podcast ID, visibility/owner, authoritative canonical locator and existing provider identities |
| Locator alias | Scope, lookup key, source ID and accepted-evidence reference |
| Identity evidence | Origin/type, observation time and sufficient protected provenance to explain an association or canonical change |
| Reconciliation case | Conflicting source IDs and reason, kept in an authorized operational workflow |

For public sources, the alias lookup key represents the safely normalized URL. Private keys use the ownership model's lookup fingerprint. Enforce scope consistency between alias and source so an alias cannot bypass authorization. Do not add a second independently editable canonical flag to alias rows.

Keep current provider columns initially; a generic provider table is not a prerequisite. Preserve their uniqueness, with private/public policy enforced consistently. Do not use nullable-owner uniqueness that accidentally allows duplicate public alias keys.

Normalization must not change resource or credential meaning. Do not blindly force HTTPS, remove or reorder query parameters, change path case, strip trailing slashes or decode reserved characters. Scheme changes and host moves need evidence beyond textual similarity.

## Resolution evidence and decisions

Extend the fetch result to retain the requested locator, effective response locator and bounded redirect hops/statuses alongside parsed data and validators. Parse feed self-links and publisher move hints as separate fields; a channel website link is not a feed identity.

| Evidence | Decision |
| --- | --- |
| Authorized, accepted exact alias | Reuse its source without creating another row |
| Trusted known provider identity | Reuse that source; validate any new locator separately instead of overwriting the canonical locator blindly |
| Validated permanent public-source move, with no conflicting identity | Reuse or establish the source, retain the old alias and adopt the verified locator under canonical-selection policy |
| Temporary redirect or generic delivery endpoint | Use for transport only; do not automatically claim the target as a durable identity alias |
| Self-link or publisher move hint without sufficient verification | Return/schedule verification; do not silently create a conflicting identity or claim the hinted source |
| Provider and URL evidence point to different established sources | Return an explicit identity conflict and create a protected reconciliation case |
| New, valid source with no established identity | Create within the authorized scope after final uniqueness checks |
| Matching title, author, episode GUIDs or content alone | At most a review signal; never automatic merge authority |

A redirect chain ending in a temporary endpoint does not make that endpoint canonical. Multiple credentialed sources may share a delivery host or endpoint. Redirects, feed hints and even permanent redirects therefore need source validation, conflict checks and ownership scoping, not an unconditional “use response.url” rule.

Apply safe-fetch rules at every hop: permitted protocols, public destination checks where appropriate, DNS/redirect defenses, bounded time/body/redirect limits and no forwarding credentials indiscriminately across origins. Rejected destinations must not become stored aliases.

## Shared resolver algorithm

Use one server-only resolver whose input includes authorized scope and optional verified provider evidence. Return a typed outcome such as resolved, created, verification-pending, identity-conflict or unavailable. Public errors must not disclose another owner's source or private locator.

1. **Authorize and check known identities.** Look up accepted aliases and provider identities in scope. Gather all matches; do not hide a disagreement behind an OR query with `LIMIT 1`.
2. **Collect missing evidence.** Fetch/verify outside a long database write transaction. Preserve redirect and publisher-hint evidence separately from the proposed canonical decision. Known identity lookup need not block on a routine freshness check.
3. **Derive the claim set.** Include the verified stable locator/provider keys shared by competing imports, not just each caller's original URL. Reject or defer ambiguous evidence.
4. **Lock and recheck.** Acquire scope-qualified identity locks in deterministic order and lock matched source rows consistently. Re-read aliases/provider matches inside the transaction because another import may have committed during fetching.
5. **Resolve or report conflict.** If the evidence now converges on one source, reuse it. If no source exists, create one and atomically claim its identities. If established matches disagree, do not create a third source or delete either existing source.
6. **Persist accepted evidence.** Add aliases, update the canonical locator only under the selection policy, and write episode/poll state against the stable source ID. Changing locators resets incompatible conditional-fetch validators.
7. **Recover bounded races.** Unique constraints are the final authority. A conflicting claim retries by reading the winning identity within a bounded policy; it is not proof that arbitrary matching rows are interchangeable.
8. **Return canonical data.** DTOs, links and caches use the resolved source ID and authoritative locator, not the originally submitted alias.

Concurrent imports with no shared verified evidence cannot be guaranteed to converge. Surface verification/reconciliation work instead of pretending content similarity is a safe universal key.

## Canonical selection and alias lifecycle

- Keep an established canonical locator unless a verified move or reviewed override supersedes it.
- Treat a directory's advertised URL as evidence; an older bulk import must not silently downgrade a verified canonical choice.
- Preserve accepted historical public aliases so a later import does not recreate the old source.
- Revalidate contested or apparently reassigned aliases. Do not automatically transfer them between existing sources based on one changed response.
- A rotated private credential must not be revived as the active locator through an old alias. Retired aliases remain subject to owner authorization and the chosen retention policy.
- Cache accepted resolution by stable source/scope. Invalidate affected alias/source entries on changes; avoid global cache flushes and shared secret-bearing URL keys.

Feed aliases are part of the source domain, not a permanent compatibility layer for obsolete client API payloads.

## Existing identity conflicts

Reconciliation remains a separate guarded operation, not a side effect of a read or ordinary import.

For each approved case:

1. Establish the surviving source and authoritative metadata from trusted evidence; choosing the smallest ID is not a sufficient rule.
2. Inventory all foreign keys and client-visible references, including subscriptions, progress, saved items, transcripts and content retention.
3. Map duplicate episodes using source-scoped identity and verified correspondence. Preserve IDs where possible; do not merge by title or global GUID alone.
4. Define conflicts explicitly. In particular, maximum playback position does not preserve rewind/relisten intent, and “latest row wins” is not universally safe.
5. Take and verify a protected backup, coordinate writers, apply the reviewed mapping atomically and check postconditions.
6. Repoint accepted aliases to the survivor and invalidate affected caches so the original import path cannot recreate the duplicate.

Unresolved ownership returns to [source classification](private-feed-ownership-plan.md#existing-data-classification); an identity conflict must not assign an owner or bypass quarantine.

## Implementation slices

| Slice | Work | Main integration points | Acceptance |
| --- | --- | --- | --- |
| Contract and schema | Define scope, alias uniqueness, evidence and resolver outcomes; establish tracked migrations | Source schema, ownership design and migrations | Constraints reject duplicate claims and scope mismatch |
| Fetch evidence | Retain redirect provenance, parse self/move hints, apply safe-fetch bounds | `src/server/ingest/feed-refresh.ts`, `src/app/api/feed/parser.ts` | Permanent/temporary/hinted moves are distinguished; unsafe evidence is rejected |
| Shared resolver | Implement claim-set locking, rechecks, canonical policy and explicit conflicts | `src/server/ingest/index-podcast.ts`, `src/server/ingest/resolve-podcast.ts` | Known aliases converge sequentially and concurrently |
| Online callers | Route URL imports, OPML, search resolution, page-triggered ingestion and refresh through the policy | `src/server/ingest/podcast.ts`, `src/server/subscriptions.ts`, feed/search routes and rendering callers | Every entry point returns the same authorized source and canonical data |
| Catalog writers | Apply the same identity rules to charts, full/incremental index sync and maintenance importers | `src/server/ingest/charts.ts`, `scripts/sync-podcast-index.ts`, `scripts/patch-null-itunes.ts` | No writer bypasses claims or overwrites a verified canonical locator |
| Backfill and cutover | Seed accepted aliases, review conflicts, coordinate writers/clients and retire direct legacy insert paths | Migration tooling and protected operational workflow | Backfill is restartable, references are preserved and alias reimports do not recreate reviewed duplicates |

Bulk jobs must not fetch every source merely to adopt the shared policy. Reuse trusted identifiers/accepted aliases and enqueue bounded verification for unresolved evidence. Keep network work outside the identity-claim transaction.

Backfill consumes the ownership plan's reviewed classification; it does not infer visibility from stored URLs. Coordinate with its [rollout requirements](private-feed-ownership-plan.md#rollout-requirements), cutting over all writers together or otherwise preventing old writers from creating unclaimed identities during migration.

## Regression matrix

Use synthetic feeds, local HTTP fixtures and isolated PostgreSQL schemas; never live private feeds or production mappings.

| Scenario | Expected result |
| --- | --- |
| Same exact URL, sequential and concurrent imports | One source and one effective identity claim |
| Verified HTTP-to-HTTPS move | Same source; original alias retained |
| HTTP/HTTPS variants without equivalence evidence | No blind rewrite or unsafe merge |
| Permanent redirect to a known source, both import orders | One source; canonical locator selected by policy |
| Different aliases imported concurrently | One source when shared verified identity evidence exists |
| Temporary redirect/CDN endpoint | No durable identity claim based solely on the transport target |
| Self/move hint that is unverifiable, unsafe or inconsistent | Explicit verification/conflict outcome; no unwanted source association |
| Provider identity and URL already belong to different records | Explicit reconciliation case, not silent preference or a third row |
| Trusted provider ID added to an established RSS source | Stable source identity, with uniqueness/conflict checks |
| Stale catalog import advertises an old alias | Existing canonical choice is retained |
| Identical titles/GUIDs/content across distinct sources | No automatic merge |
| Same locator/content across private owners or public/private scopes | Isolation preserved; no cross-owner alias lookup or metadata leak |
| Credential rotation and retired alias reuse | Stable owner-authorized identity; obsolete credential not restored as active |
| Failure between source creation and alias/provider claims | Transaction rollback; retry leaves one complete identity |
| Reconciled source imported again through an old accepted alias | Resolves to survivor without recreating a duplicate |
| Alias/source change with warm caches and polling validators | Canonical responses, scoped invalidation and a valid subsequent refresh |

Existing exact-key concurrency and provider-ID tests must continue to pass alongside these cases. Completion requires the whole ingestion surface to follow the policy, not just a new helper or a one-time data cleanup.

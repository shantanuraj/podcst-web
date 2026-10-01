# Documentation map and triage

Reviewed against source revision `01b3c40`. This is a source-and-test assessment, not a production deployment or physical-device certification. Reassess a row when its implementation or acceptance evidence changes.

**Implemented** means the described behavior exists in code. **Stale** means treating the document as current guidance would be misleading. A dated baseline is historical evidence, not automatically stale or redundant. Plans can contain implemented work and still have open acceptance gates.

## Per-document assessment

| Document | Assessment | Recommended action |
| --- | --- | --- |
| [First-release roadmap](first-release-roadmap.md) | **Current; partially delivered product scope.** Listening foundations exist; saving, richer sharing and several release contracts remain planned. | Keep as the release-scope authority. Link feature plans rather than copying their implementation steps. |
| [Pre-release foundations](pre-release-foundations.md) | **Current; mostly planned changes.** Existing transport boundaries and identity/content separation are foundations to retain, not evidence that the entire plan is complete. | Keep as the architecture/dependency overview; detailed ownership and identity decisions belong in their respective plans. |
| [Private-feed ownership](private-feed-ownership-plan.md) | **Current; ownership design pending.** Read-only inventory helpers exist, but they do not implement the proposed source model and authorization contract. | Keep active. Do not mark the plan implemented because audit tooling or client account-scoped caches exist. |
| [Feed identity resolution](feed-identity-resolution-plan.md) | **Current; alias-aware design pending.** Exact-key/provider lookup exists; alias/evidence resolution remains planned. Bounded operator reconciliation tooling is separate. | Keep active and retain its separation from the ownership plan. |
| [Guarded podcast reconciliation](podcast-reconciliation.md) | **Implemented operator tooling with isolated tests.** Repairs reviewed public-source pairs while preserving episode/user state; does not supply permanent aliases or private ownership. | Keep as the generic runbook. Store production plans, backups and receipts outside Git. |
| [Audio experience](audio-experience-plan.md) | **Mostly implemented; release validation incomplete; mixed historical/current text.** The architecture remains useful, but the starting-point table and early milestone narratives are not a current backlog. | Keep architecture and open gates; move completed work/evidence into a clearly historical section. Refresh the top-level implementation summary. |
| [Audio device validation](audio-device-validation.md) | **Current, open validation worksheet.** Automated scheduling evidence does not complete the pending listening, route, responsiveness or power matrix. | Keep active. Update only with exact-build evidence; do not archive as “implemented.” |
| [Audio Lab inspection](audio-lab-inspection-plan.md) | **Implemented development-tool contract with dated validation evidence.** Inspection, metering, comparison and capture paths exist. | Keep as a reference, not an implementation backlog; a future rename can remove `-plan`. Physical listening remains a separate gate. |
| [Artwork sizing/cache](ios-artwork-cache.md) | **Client implementation present; mixed reference, measurement and rollout history.** External proxy/deployment claims cannot be certified from this repository alone. | Keep the client/proxy contract, separate dated measurements from current behavior, and replace stale rollout language only after verification. |
| [Artwork measurements](ios-artwork-measurement.md) | **Historical pre-change baseline, intentionally superseded as an implementation description.** Its measured baseline still has comparison value. | Keep as evidence or move to an archive after privacy review. Do not treat its loader recommendations as unfinished work. |
| [iOS parity baseline](ios-parity.md) | **Historical web audit; stale as a current product/native inventory.** Much of the proposed native functionality now exists; some outstanding cross-client requirements remain relevant. | Retire from the active planning set after carrying remaining requirements into the release roadmap. Preserve its dated web-audit context. |
| [Tiered-storage design](superpowers/specs/2026-05-30-tiered-episode-storage-design.md) | **Core architecture implemented; several behavioral assumptions outdated.** It is not a current operational specification. | Replace with a concise current storage reference, then archive/sanitize the historical rationale. Do not reuse its capacity or deployment assumptions as current facts. |
| [Tiered-storage execution plan](superpowers/plans/2026-05-30-tiered-episode-storage-1-split-and-migration.md) | **Largely implemented, stale execution recipe, substantially redundant with code.** Open checkboxes do not describe the remaining work. | Highest-priority archive/retirement candidate. Do not execute its historical migration/cleanup instructions as a current runbook. |

No document should be deleted solely because code now exists. Preserve unique design rationale, baseline evidence and unresolved acceptance criteria first.

## Concrete evidence and drift

### Tiered storage: retire the old execution recipe

Implementation is present in:

- [Tier schema additions](../migrations/0008-tiered-episodes.sql), [pre-swap script](../scripts/migrate-tiered-episodes-pre.sql) and [post-swap script](../scripts/migrate-tiered-episodes-post.sql).
- [Split identity/content writes](../src/server/ingest/episodes.ts).
- [Current read preparation and pagination](../src/server/ingest/episode-read.ts) and [their integration tests](../src/server/ingest/episode-read.integration.test.ts).
- [Tier derivation and warm eviction](../src/server/tiering.ts), [refresh job](../scripts/refresh-tiers.ts) and [feed scheduling](../src/server/ingest/feed-schedule.ts).

Specific stale guidance:

- The plan defers warm LRU eviction to a later plan, but `evictWarm()` is already called by the tier refresh job.
- It names a combined `scripts/migrate-tiered-episodes.sql`; the repository instead has pre/post scripts. Its old helper names, recursive read example and proposed unit-test filename are not the current implementation.
- The current reader uses `prepareEpisodeRead()` and `readEpisodePage()`. The historical recipe must not be used to reintroduce an obsolete read implementation.
- Scheduling includes followed/recently played sources before tier recomputation catches up; it is not merely the old `is_essential` predicate.
- Content preparation rebuilds an entirely evicted show, while a current integration test explicitly preserves partially retained content without rebuilding. The old design's broad per-episode recovery description is therefore not an exact contract.
- Warm eviction uses an estimated content-row budget. That is not proof of a hard total database/storage ceiling.
- “All content is re-derivable” is not an adequate future saved-episode retention rule. Reconcile that assumption with the [release roadmap's saving semantics](first-release-roadmap.md#saving-semantics).

Live migration/deployment status and operational reclamation were not re-audited here. Implementation presence does not authorize rerunning a destructive migration.

### Audio: implemented code is not completed validation

[PodcstApp](../ios/Podcst/PodcstApp.swift) installs [RoutingAudioTransport](../ios/Podcst/Playback/RoutingAudioTransport.swift), which selects native playback for supported sources and system fallbacks where required. The [speech processor](../audio-engine/src/speech.rs), [media store](../ios/Podcst/Playback/Media/MediaStore.swift), [audio preferences](../ios/Podcst/Playback/AudioPreferences.swift), [audio settings UI](../ios/Podcst/AudioSettingsView.swift) and [progress writer](../ios/Podcst/Playback/PlaybackProgressWriter.swift) establish that the main feature work is present.

The audio plan's early statements about ordinary playback remaining on the system transport, effects still being future work and progress writes still needing serialization must stay scoped to their historical milestones. Its current summary should not send implementers back through completed packages.

The [dedicated audio executor](../ios/Podcst/Playback/LocalAudioWorker.swift) and [scheduling regression](../ios/PodcstTests/AudioSchedulingTests.swift) also supersede the older blanket statement that UI-stall scheduling remains untested. They do not close the broader physical listening/power gates. The [device worksheet](audio-device-validation.md) correctly keeps those separate.

Audio Lab implementation is visible in [inspection session/capture](../ios/AudioLab/AudioLabInspectionSession.swift), [inspector UI](../ios/AudioLab/AudioLabInspectorView.swift), [comparison rendering](../ios/Podcst/Playback/AudioComparison.swift), [metering](../ios/Podcst/Playback/AudioSignalMeter.swift) and corresponding inspection/comparison/meter tests. Its design document is an implemented-feature reference, not redundant merely because [the audio-engine README](../audio-engine/README.md) also explains how to use the lab.

### Artwork: preserve the before/after distinction

The baseline's original loader description is superseded by [ArtworkStore](../ios/Podcst/ArtworkStore.swift), [ArtworkRetention](../ios/Podcst/ArtworkRetention.swift) and [artwork tests](../ios/PodcstTests/ArtworkStoreTests.swift): frame-sized variants, explicit disk retention, scoped cleanup and stale revalidation are implemented. Web responsive selection and fallback are in [artwork helpers](../src/shared/artwork.ts), [ProxiedImage](../src/ui/Image/ProxiedImage.tsx) and [web artwork tests](../src/shared/artwork.test.tsx).

The measurement document explicitly says it is a pre-change baseline. That is useful provenance, not a claim that today's loader still behaves that way. Do not delete it as a duplicate of the implementation document or reinterpret proxy-body measurements as post-change physical-device memory/network results.

The proxy server is maintained outside this repository. Its present deployment, admission controls and current device performance need separate evidence; this audit did not fetch production endpoints or inspect that sibling implementation.

### Parity and foundations: avoid false completion labels

Native [library](../ios/Podcst/Core/LibraryStore.swift), [queue controls](../ios/Podcst/QueueView.swift), [session handling](../ios/Podcst/Core/SessionStore.swift), downloads and custom audio now cover substantial parts of the historical native proposal. Remaining release requirements still need their own acceptance evidence.

The parity audit also contains inconsistent search descriptions. The [current search path](../src/app/api/search/search.ts) obtains term results from the provider and maps known database identities; it is not simply the indexed-catalog search described in one row. Retire the snapshot as an active inventory instead of patching only one sentence and implying the whole audit is current.

The newer foundation and domain plans remain needed: current [identity indexing](../src/server/ingest/index-podcast.ts), [migration runner](../scripts/migrate.ts), [server progress](../src/server/progress.ts) and client models are not implementations of every proposed alias, migration-ledger, cross-client contract or revisioned-sync requirement. Existing pieces should be credited without marking those larger changes complete.

## Consolidation boundaries

- **Release roadmap:** scope, ordering and ship criteria.
- **Foundations:** architecture principles and dependencies, with links to domain designs.
- **Ownership:** visibility, authorization, secret handling, classification and account lifecycle.
- **Identity:** aliases, canonical selection, concurrent claims and record reconciliation.
- **Audio architecture:** transport/DSP contracts and acceptance definitions.
- **Device worksheet:** outstanding checks and measured results; reference acceptance definitions rather than duplicating an evolving set of thresholds.
- **Audio Lab reference:** inspection/capture/comparison contracts; keep build/use instructions in the audio-engine README.
- **Artwork reference versus baseline:** current implementation/contract versus dated evidence. These are complementary, not interchangeable.

The clearest redundant material is the tiered-storage plan's copied implementation steps and code. Other overlaps are mostly summaries or deliberately different document roles; wholesale merging would lose useful boundaries.

## Recommended cleanup order

1. Retire the tiered-storage execution recipe from active use; extract a current storage reference before archiving the design.
2. Carry remaining parity requirements into the release roadmap, then archive the dated parity snapshot.
3. Split the audio plan into current architecture/open gates and historical implementation evidence; leave the device worksheet active.
4. Label Audio Lab as an implemented reference and separate artwork rollout history from its stable contract. Retain the pre-change artwork baseline for comparison.
5. Keep the four current release/foundation/domain plans active and maintain the ownership/identity responsibility split.

Older storage/artwork notes contain environment-specific operational details or local/device artifact identifiers. Perform a privacy pass before reorganizing or republishing them; moving a file to an archive does not sanitize it. This index intentionally does not reproduce those details. Previously published history was not rewritten as part of this audit.

An adjacent correction outside `docs/` is also warranted: the root [README](../README.md) still says normal podcast playback uses AVPlayer, which does not describe the current native routing.

## Verification boundary

During this audit:

- All 12 pre-existing tracked documents were read; relative Markdown file links resolved.
- Selected Bun unit tests for tiering, episode rows, scheduling, artwork and links: **25 passed**.
- Isolated PostgreSQL read/refresh integration tests: **26 passed**.
- Offline Rust suite: **49 passed; one six-hour test remained ignored**.

Swift/simulator suites, physical-device tests, remote deployments, production databases and external proxy behavior were not revalidated. Old test totals in feature documents remain historical results, not fresh pass claims. No documents were deleted or moved during this assessment.

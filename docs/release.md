# First release: start here

Use this page to decide what to work on next for the first public iOS release and its web/backend companion. It owns **cross-plan execution order, current focus and phase sign-off**. The linked plans own their detailed requirements; do not copy their specifications into this page.

Status: proposed execution sequence. No phase is signed off here yet. Existing functionality should be reused and validated, not rebuilt merely because its release gate remains open.

## Current focus

**Recommended next: R1 — make foundational changes safe.** Establish the migration baseline and cutover/recovery contract before changing source ownership or identity.

In parallel, settle the source-policy decisions needed for R2 and begin the [physical-device validation](audio-device-validation.md). Device testing and operational preparation should not wait until feature development finishes. Any urgent containment is a separate, explicitly authorized action; it must not wait for a broader redesign.

Do not widen the feature cut while these contracts are unsettled. The [roadmap](first-release-roadmap.md#roadmap) owns launch scope and deferrals.

## Execution sequence

| Phase | Depends on | Exit condition | Authoritative detail |
| --- | --- | --- | --- |
| **R1 — Safe changes** | None | Migration history is established; representative upgrades and recovery are rehearsed; obsolete-writer/client cutover is defined. | [Migration safeguards](pre-release-foundations.md#8-treat-migrations-as-an-audited-mechanism) |
| **R2 — Trusted source identity** | R1 and agreed source policy | Ownership is enforced across all access paths; scoped aliases converge across ingestion paths; conflicts and backfills use reviewed, reference-preserving procedures. | [Ownership rollout](private-feed-ownership-plan.md#rollout-requirements), [identity implementation slices](feed-identity-resolution-plan.md#implementation-slices) |
| **R3 — Durable cross-client state** | R2 | Shared API/identity contracts, retryable user-state mutations and explicit playback transitions are proven across clients, offline recovery and account changes. | [API contract](pre-release-foundations.md#3-define-a-checked-cross-client-api-contract), [transactional state](pre-release-foundations.md#4-make-user-state-mutations-transactional), [playback intent](pre-release-foundations.md#7-separate-playback-intent-from-transport) |
| **R4 — Complete the launch workflows** | R3 | The roadmap's launch behaviors work end to end, including account lifecycle, dependable listening, saving and sharing; saved references survive content eviction and restore. | [Product roadmap](first-release-roadmap.md#roadmap), [retention foundation](pre-release-foundations.md#5-separate-saved-state-from-disposable-content) |
| **R5 — Prove and release** | R1–R4 | All applicable release gates pass for the exact candidate, including device evidence, operational recovery and distribution readiness. | [Release gates](first-release-roadmap.md#release-gates), [device worksheet](audio-device-validation.md) |

Dependencies describe completion order, not a ban on independent preparation. Within R2, agree ownership, stable source IDs, source API shape and locator policy together; enforce the access boundary before enabling new alias/import behavior. Within each phase, deliver small tested vertical slices across backend and clients rather than separate, disconnected layer rewrites.

The foundations plan also defines [bounded ingestion](pre-release-foundations.md#6-bound-ingestion-independently-of-interactive-reads): apply that contract while implementing R2 rather than creating a separate platform project.

## Which document owns what?

| Question | Read |
| --- | --- |
| What ships, what waits, and what should each listening/saving/sharing action mean? | [First-release roadmap](first-release-roadmap.md) |
| Which foundational contracts change, and which architecture should we keep? | [Pre-release foundations](pre-release-foundations.md) |
| Who owns a source, who may access it, and how are private credentials/lifecycle handled? | [Private-feed ownership](private-feed-ownership-plan.md) |
| When do URLs resolve to one source, how do concurrent imports converge, and how are conflicts reconciled? | [Feed identity resolution](feed-identity-resolution-plan.md) |

Domain plans retain their internal implementation order and acceptance tests. This hub is the only cross-plan work sequence, not another copy of those plans. The [documentation index](README.md) distinguishes active plans from implemented references and historical evidence; it is not a second release backlog.

## Decisions and blockers

The [roadmap's decision list](first-release-roadmap.md#decisions-still-needed) is authoritative for unresolved product choices. Close the [source import/lifecycle policy](private-feed-ownership-plan.md#import-and-lifecycle-semantics) before R2 and guest-merge/conflict behavior before R3. Set the release audience, commercial scope, support and recovery commitments before making launch promises.

When a decision blocks a phase, record the decision and its disposition in the relevant plan and link it here. Do not quietly substitute an implementation assumption for owner approval.

## Working and signing off

1. Start from the earliest open prerequisite and read its linked design and acceptance criteria.
2. Update a detailed requirement in its owning document. Update this page only when execution order, current focus or phase status changes.
3. Record implementation, automated verification and device/operational acceptance separately. A merged change or simulator pass does not close every gate.
4. Sign off a phase only when its linked exit criteria have evidence and remaining blockers are resolved. Record the candidate revision and public-safe evidence reference here, then move current focus to the next phase.
5. Keep production inventories, account mappings, raw captures and recovery artifacts in protected operational storage under the [classification/evidence rules](private-feed-ownership-plan.md#existing-data-classification), not in this public hub.

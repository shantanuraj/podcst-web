# R1 operational review

Status: live evidence gathered; production sign-off remains open. This is a public-safe summary, not a production inventory or approval to apply migrations. [Release hub](release.md).

## Reviewed starting state

A delegated operational review on `sixth-1` used fixed source baseline `0fee98d` on 1 October 2026, before the R2 ownership migration. The production schema matched the reference's object names, types, defaults, constraints, indexes and sequence bindings. Differences were limited to podcast column positions and object owners. The supervisor accepted these as historical starting-state differences; no application-table rewrite is required merely to match the fresh-install layout.

This supports a prospective baseline of the verified present state. It does not retroactively certify execution of historical repair scripts or preservation of data through old destructive repairs.

The actual Vercel production web revision was `daf3fb5`; the server's writer checkout was `a2c5892`. They must not be treated as the same deployment. Fly status remained unverified and is not presumed retired.

## Evidence and limitations

- **91 isolated PostgreSQL tests passed on the server**, including migration rollback, populated upgrades and synthetic backup restore/replay.
- Approved bounded, indexed current-state observations found all sampled referenced episodes/parents. Four sequence/PK-top observations found no collision risk at capture time. These are sampled observations, not all-row or historical proof.
- Encrypted backup availability was verified and only the approved small user-data ciphertext was retrieved. No authorized private age identity was available, so real-backup decryption/restore was not performed.
- No production DDL/DML, ledger adoption, sequence advancement, service stop/restart, credential change, deployment or full database download occurred.

Detailed captures, target bindings, comparison data, backup identifiers and execution receipts remain in protected operational storage. The supervising session retains the public-safe handoff from run `1489da09-1130-4bac-868a-0d345568cd08`, workflow `1c64e46e-bfbb-4a03-98c2-3afc6eff3451`. Evidence-manifest SHA-256: `c41495659f44b64d8214e09b1256b67cf3a0d8f8c62df496f1536a27f142cc64`.

## Remaining R1 operations

1. Supply the existing authorized age identity path/access—not key contents—and complete the approved small, isolated recovery rehearsal. A public recipient and downloadable ciphertext do not prove recoverability.
2. Review/rehearse a narrowly database-bound, ledger-only adoption operation for this starting state, then obtain exact production approval. The ledger needs separate ownership/permissions so the runtime role cannot rewrite migration history. The existing runner intentionally does not silently adopt untracked databases.

The recovery rehearsal is capped and does not require copying the large catalog to a laptop. Synthetic missing parent rows can test user-state restoration, but cannot prove original source identity or full disaster recovery. Full-scale restore, rewrite/WAL capacity and RPO/RTO remain separate release evidence.

## Cutover definition accepted, not executed

Before a production migration, gate application mutations and side-effecting reads, coordinate poller/charts/tiers/manual writers, drain affected sessions, pin fresh evidence/backup state and deploy compatible revisions before reopening. Inspect actual state after an uncertain commit rather than retrying blindly.

Before R2 private imports, obsolete web/preview/Fly deployments must also lose database **read** access: old readers do not enforce the new owner boundary. Resolve the authoritative deployment set, use reviewed credential/access cutover, resume only matched writer revisions and invalidate only affected rebuildable caches.

R2 code development and disposable-database tests may proceed. None of the above constitutes production adoption or R1 sign-off.

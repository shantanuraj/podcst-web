# Account deletion and local cleanup

The [API contract](../api/README.md#account-erasure-protocol) defines publication,
proofs and receipt lookup. The synthetic [fixtures](fixtures.json) fix response
shapes; their clock is controlled by tests. A receipt is not a session credential.

## Preparing and submitting

1. Persist an account-scoped preparation intent before suspending that account's
   work. A failed checkpoint prevents submission. Never suspend another account.
2. Prepare only for the same verified account. Check the returned `accountId`
   against the captured owner; cookies/session identity may have changed while
   preparing. The server derives this ID from its verified session, not the body.
3. Persist operation ID, receipt and the separate proof/receipt expiry times before
   allowing submission. Never persist the email code. A lost preparation response
   cannot itself submit deletion.
4. Persist submission-unknown **before** issuing DELETE. Reuse the same operation
   and receipt after an uncertain result; do not overwrite them with a new attempt.
   Only an unsubmitted preparation can be cancelled. Cancellation resumes work only
   for the same still-verified account.
5. Accept a destructive acknowledgement only for the saved operation ID. `pending`
   and every unknown outcome retain work; missing/malformed responses and HTTP
   errors never authorize cleanup. A pending response may include a display message.
6. Receipt lookup is session-independent and cannot modify a different active
   account's credentials. Expiry discards the capability, not the unresolved local
   account state. Previously persisted positive completion remains positive after
   receipt expiry; cleanup can resume offline without another status request.

## Acknowledged cleanup

Persist server completion separately from the cleanup checkpoint. Before deleting
anything locally, persist either explicit server confirmation or an explicit local
user choice. Local choice never labels the server account deleted.

Cleanup checkpoints name the next operation:

| Checkpoint | Required acknowledgement before advancing |
| --- | --- |
| `retire` | Fence the target's callbacks, private readers and pending senders; stop/release its playback, timer, link and clip work |
| `media` | Await target-owned downloads/cache/temporary media retirement; dispatching background removal is insufficient |
| `data` | Await B's target-scoped durable/queue/list and other owned metadata cleanup |
| `credentials` | Acknowledge removal of only the target's local credential/session metadata; storage/keystore failure remains incomplete |
| `complete` | All earlier steps and the final durable checkpoint succeeded |

Each hook must be idempotent: process death after its side effects but before its
checkpoint causes a retry. Missing hooks, unavailable storage and unacknowledged
media removal are failures, not successful empty work. Startup must install the
persisted account fence before restoring that account's work. Late callbacks and
A→B→A transitions cannot recreate erased state or erase B/guest work.

The coordinator requires durable storage and cross-context exclusion from each
platform adapter. A model mutex test is not browser multi-tab or native process/
keystore/media acceptance. Platform hooks must preserve unattributed retained
sources rather than deleting them to manufacture success; report cleanup incomplete
where safe ownership or acknowledgement cannot be established.

## Disclosure

Display server confirmation and this installation's cleanup separately. A 401,
unknown status or expired receipt is not deletion proof. Other/offline installations
retain work until they have confirmation or explicit local erasure choice. Do not
claim to erase OS/provider caches or exported copies remotely.

Deleting an account does not cancel publisher subscriptions or revoke publisher
RSS tokens. Server-derived chapter caches retain their existing expiry behavior;
this protocol does not authorize a server cache purge or change that retention.
Production activation requires separate operational readiness and approval.

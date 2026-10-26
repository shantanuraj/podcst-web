# Account deletion

Web: `https://www.podcst.app/account#delete`. Native: Settings → Delete account.
The web page is accessible while signed out and returns to the deletion section
after sign-in. `/privacy#deletion` explains the deletion flow.

## API

1. `POST /api/account/deletion` with `{accountId}` sends a separate six-digit
   deletion code. The session and account must match. The response contains
   `{accountId, operationId, receipt, expiresAt, proofExpiresAt}`. Proofs last five
   minutes, allow five attempts and cannot be used for sign-in. Receipts last
   seven days; only their SHA-256 digests are stored on the server.
2. `DELETE /api/account/deletion` with `{operationId, code, confirmed:true}`
   consumes the proof and accepts permanent deletion. The response contains
   `{operationId,status:"completed"}` or HTTP 202 with
   `{operationId,status:"pending"}`. Accepted requests cannot be cancelled.
3. `POST /api/account/deletion/status` with `{receipt}` is session-independent
   and returns `completed`, `pending` or `unknown`. These requests never change
   session cookies. A 422 means proof was rejected before acceptance; a 401,
   missing receipt or transport error never proves deletion.

An unknown submission can request a new proof for the same authenticated account.
The existing record stays intact until preparation succeeds. The server refuses
new preparation once deletion has been accepted.

## Client cleanup

Clients checkpoint pending work, retain the receipt before submission, and persist
an unknown outcome before sending DELETE. Only confirmed deletion starts cleanup:
stop playback and account work, clear matching credentials, remove media, then
erase scoped state. Interrupted cleanup resumes at its saved stage, including
while offline after server confirmation. Guest and other-account data remain.

Web cleanup requires all three state stores and acknowledgements from other open
tabs. Native clients keep deletion records in protected application storage.
Proof codes are never persisted. Android media and artwork keys include their
account scope; files with unknown ownership are preserved and cannot be reported
as successfully removed.

Migration `0026-account-deletion-receipts.sql` adds receipt storage. Deployment and
operational activation are documented separately in the private operations repo.

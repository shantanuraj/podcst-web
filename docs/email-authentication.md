# Email authentication

Email issuance and redemption require PostgreSQL, Redis and `AUTH_CODE_SECRET`.
The secret must be at least 32 cryptographically random bytes encoded as hex,
shared by all application instances and stored outside Git. It protects code
and limiter digests. Rotating it invalidates outstanding codes and resets limiter
namespaces. Email delivery also requires `RESEND_API_KEY`; `EMAIL_FROM` is optional.

The server does not infer proxy trust from forwarded headers. By default all
requests share the conservative `unattributed` source budget. Set
`AUTH_TRUSTED_IP_HEADER` only when the ingress overwrites that header with one
verified client IP and direct access to the application is prevented. Missing,
invalid or comma-separated values share the unattributed budget. Never configure
a client-controlled header or accept an arbitrary `X-Forwarded-For` chain.

## State and limits

- Exact email strings remain account identities. Case-folding applies only to
  abuse-limit subjects; it neither changes codes' identity binding nor merges users.
- Six-digit cryptographic codes expire after ten minutes and five guesses.
- Sends: 60-second cooldown, five/hour/email, 20/hour/trusted source.
- Verification: five guesses times the send budget, or 25/hour/email and
  100/hour/source, shared by verification-only and login requests.
- Sliding-window Redis limits consume all relevant budgets atomically and return
  `Retry-After` on rejection. Unavailable dependencies fail closed with 503.
- Provider failures or a ten-second delivery deadline never activate a code.
  Delayed delivery can produce an unusable email, not an authentication bypass.
- Redemption, account creation and session insertion commit together. A lost
  response may leave a committed session; the consumed code cannot be replayed.
- Existing session reads and logout do not depend on this secret or Redis.

`lockEmailIdentity` is the transaction lock for issuance and redemption. Future
account deletion must acquire it before locking the user, and remove matching
verification rows in the deletion transaction. Deletion proof must be a separate,
purpose-bound flow, not reuse login's account-creation semantics.

## Activation and recovery

Migration `0009-email-code-security.sql` removes outstanding plaintext codes,
replaces the code column with a digest, and retains at most one row per email.
It intentionally invalidates every in-flight code. Existing sessions and users
are unchanged. Old application writers are incompatible with the new schema;
coordinate writer retirement, secret provisioning and application activation
before applying it. No fallback to plaintext or process-local limits exists.

This is implementation guidance, not deployment approval. Rehearse the migration
and backup/restore on synthetic data. Never restore old usable verification codes
or obsolete credentials as a rollback strategy. The selected backup includes the
new verification schema; existing historical backups require their own retention
and access review.

## Tests

```sh
PG_BIN=/path/to/postgresql/bin bun --no-env-file test src/server/auth/email-service.integration.test.ts src/server/auth/limits.integration.test.ts src/server/auth/email-handlers.test.ts
```

PostgreSQL and Redis tests create disposable local instances. Install
`redis-server` to run concurrency/limit tests; no production services are used.

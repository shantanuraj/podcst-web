# Store reviewer accounts

Migration `0025-review-accounts.sql` registers at most one Apple account and one
Google account. Each registration references an ordinary user and holds a
purpose-separated HMAC of its reusable six-digit login code. The user row owns
the email. Runtime access to this table requires **SELECT only**; enrollment,
preparation and rotation belong to the separate operator connection.

The email/code screens advance after a successful code request. Requests for the
exact `podcst.app` domain, matched without case sensitivity, succeed without
generating an OTP or attempting email delivery. Other domains receive an ordinary
short-lived code. Domain membership alone never authenticates or enrolls a user.
Only `/api/auth/email-login` accepts the reusable credential, without consuming
or requiring an ordinary verification row.
`/api/auth/verify` never checks the registration. Both paths retain the existing
request checks, Redis limits, session creation and cookie rotation. Registered
addresses are normalized to lowercase, including when an emailed OTP logs into
that registered account; ordinary account identities retain their exact spelling.
Changing `AUTH_CODE_SECRET` invalidates reusable codes until their digests are
reissued. There is no previous-code fallback or automatic expiry.

## Operator interface

[`scripts/review-account.ts`](../scripts/review-account.ts) requires an explicit
`REVIEW_DATABASE_URL`; it never falls back to the application database. Protected
JSON inputs and outputs must live outside every Git checkout in an operator-owned
`0700` directory. Files must be regular, owner-only files. Outputs are created
exclusively, synced to disk and read back. Credentials are accepted only through
protected files, never command-line values. No command prints codes, digests,
emails or private feed URLs.

| Command | Required options | Optional options |
| --- | --- | --- |
| `sampler-token` | `--output FILE` | |
| `credential` | `--config FILE --output FILE` | |
| `plan` | `--config FILE --action create\|reset\|rotate\|remove --submission REF --reference FILE --output FILE` | `--credential FILE` |
| `apply` | `--config FILE --plan FILE --target production\|development --output FILE` | `--credential FILE` |
| `inspect` | `--plan FILE --target production\|development` | |
| `verify` | `--config FILE --plan FILE --credential FILE --output FILE` | `--skip-send` |

Run commands with `bun --no-env-file scripts/review-account.ts`. Supply connection
settings and `AUTH_CODE_SECRET` through protected environment configuration.
The configuration object contains `store` (`apple` or `google`), normalized
`email`, `target`, HTTPS `apiOrigin` without a trailing slash, and `feeds` with
canonical HTTPS `public` and `private` URLs. Credential files contain `store`,
`email` and string `code`. `credential` generates and persists a cryptographically
random code; `sampler-token` writes a separate random 256-bit `token`. Preserve
the prior credential separately until a deliberate rotation commits.

`--reference` is an active-chain reference from the [schema inventory
tool](schema-inventory.md). Planning checks the complete migration ledger and
schema and pins schema/access definitions, PostgreSQL cluster/database/role,
application source and configuration, account fingerprint and affected row
counts, operation ID, submission and seed digest. The operator role needs
catalogue reads, execution of `pg_control_system()` to identify the cluster, and
the account/catalogue privileges needed by the selected action. The tool never
grants itself permissions.

Reference comparison uses column names for ordinary public tables, allowing
historical physical positions while preserving all other captured definitions.
The plan pins the exact target layout and grants; any later layout change still
requires a new plan. Planning and applying refuse a recorded database collation
version that differs from the installed provider.

`create` refuses an existing email, including another spelling of the same
normalized address. `reset` deletes the enrolled user and creates a new ID with
the same email and seeded state. Supplying a credential rotates the code in that
transaction; omitting it preserves the digest. `rotate` requires a different code
and revokes sessions, passkeys and pending email codes without replacing library
state. `remove` revokes those credentials and deletes the registration without
erasing the user. Addresses at `podcst.app` cannot request an ordinary email code
after removal either.

The lock order is normalized email identity, store, registration, user, account
dependencies, then sampler identities and state/list resources. Foreign keys
derive the account dependency inventory. Preparation refuses cross-account
private references and erasure bookkeeping. Network and secret-custody work
finishes before locks are taken. Every replacement and its receipt commit
together, including validation of deferred constraints. Existing sessions,
passkeys and replay state cannot attach to the new user ID. The global state
generation is unchanged; local downloads, queues and device caches are outside
the reset boundary.

Any source, schema, credential, account or seed drift requires a new plan. After
an uncertain outcome, `inspect` reports whether this is the current committed
operation. Reapplying the same committed create/reset/rotate returns its receipt;
a superseded operation is refused. Removal has no surviving registration receipt:
inspect the protected result and current registration before attempting further
work. Never restore an old account or credential to undo preparation.

`verify` checks the committed receipt, revalidates media, exercises the code-request
endpoint, signs in twice with the reusable code, and checks both normal sessions,
account preferences, follows, progress, ordered lists and private-feed reads.
Temporary verification sessions are logged out. `--skip-send` permits a repeat
check without consuming another send; `codeRequestChecked` records whether that
request ran, not whether an email was delivered. Limits remain enforced. The
seeded playlist exists in the list API; client playlist presentation remains the client's existing feature
set. HTTP verification does not establish signed native or retained-install
behavior.

## Sampler

[`contracts/review/seed.json`](../contracts/review/seed.json) fixes the two followed
feeds, six episode GUIDs, partial/completed progress, two stars, ordered three-item
playlist and seed revision. Audio preferences use the shared defaults.

The original scripts and artwork are part of this repository's MIT-licensed
content. The six recordings use eSpeak NG 1.52.0's English voice and FFmpeg's MP3
encoder, with three embedded ID3 chapters each. They contain no third-party
recordings or customer data. [`build-review-sampler.ts`](../scripts/build-review-sampler.ts)
rebuilds the media and asset manifest; changed tools can change bytes, so review
and version any regeneration. Runtime serving needs neither speech software nor
FFmpeg. The public media assets live at `/samples/review/v1/`.

`/api/sampler/public` serves the four-episode public feed. A separate 64-character
hexadecimal token for each store enables `/api/sampler/TOKEN`, backed by
`REVIEW_SAMPLER_APPLE_TOKEN` and `REVIEW_SAMPLER_GOOGLE_TOKEN`. Configure different
tokens in protected runtime settings. Private feed URLs are bearer locators for
demonstration content; imported database records use normal account ownership.
Their audio files are public demonstration assets. Unknown or unconfigured tokens
return 404, and responses are private/no-store. `REVIEW_SAMPLER_ORIGIN` defaults to
`https://www.podcst.app` and controls asset links. Use the canonical host to avoid
redirects during media validation. Keep the tokens out of ingress logs.

Preflight fetches both feeds, checks GUIDs and durations, validates the original
artwork and every MP3 against the committed SHA-256/length manifest, and checks
real byte-range responses. HTTPS, bounded public destinations and fixed media
identities are required. Existing public catalogue content is reused unchanged;
conflicts abort preparation. Each store's private feed is imported for its new
user, using the same catalogue, follow, progress and list implementations as the
application.

## Recovery and validation

The selected backup intentionally excludes `review_accounts`. A fresh restore
therefore disables reusable review login. Restoring a full database requires
explicitly clearing stale registrations before admission. Reconcile current
credential custody, account bindings and revocations before restoring review
access; initial enrollment never adopts a restored ordinary user automatically.
This does not provide product account deletion or post-checkpoint erasure replay.

```sh
TZ=UTC PG_BIN=/path/to/postgresql/bin bun --no-env-file test \
  scripts/review-account.integration.test.ts scripts/review-sampler.test.ts \
  src/server/auth/review-login.integration.test.ts scripts/podcst-backup.test.ts
```

The built application runner also exercises normal reviewer HTTP login, sampler
range serving, private access and account retirement under a runtime role with
read-only registration access. Production grants, hosting, client sign-in,
secret custody and signed Apple/Google client checks require a separate rollout.

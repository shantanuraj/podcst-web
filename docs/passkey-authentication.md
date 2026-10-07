# Passkey authentication

All three clients use discoverable login and server-issued `flowId` values.
Registration binds its flow to both the authenticated account and the issuing
session. Client-generated visitor IDs and email-based account/passkey discovery
are not supported. See the [API contract](../contracts/api/README.md).

Redis holds challenges for five minutes with atomic `GETDEL` consumption. It must
support `GETDEL` (Redis 6.2+). Challenge issuance is limited to 20/hour/trusted
source; verification shares the authentication request budget. PostgreSQL serializes
credential counters and commits successful assertion/session creation together.
Registration rechecks session validity under lock before inserting a credential.
Dependency failures never fall back to a process-local map or skip verification.

Successful login replaces the presented session cookie and revokes its old row.
Existing session reads and logout remain independent of Redis and
`AUTH_CODE_SECRET`. Responses, including auth errors, are private/no-store.

## Request boundary

Configure `WEBAUTHN_RP_ID` and `WEBAUTHN_RP_ORIGIN` for the intended browser origin
(`WEBAUTHN_ORIGIN` remains the existing alternative). The browser Origin must match
exactly; cross-site Fetch Metadata is refused. Native clients explicitly send
`X-Podcst-Client: native`, without browser Origin/Fetch Metadata. This marker is
not a credential: it makes browser cross-origin calls require a preflight, which
is not granted. Account/session authorization and WebAuthn RP/origin validation
remain mandatory. Do not add permissive CORS rules around this boundary.

The API proxy applies this policy to unsafe methods on every API path, including
logout and account mutations. This requires coordinated web/server/native
activation: old clients without flow IDs or the native marker are incompatible.
The [auth secret and trusted-source setup](email-authentication.md) is also required.
No deployment or credential provisioning is implied by these source changes.

## Native registration and verification

The iOS AuthenticationServices coordinator supports both assertions and
attestations, forwards base64url credential data, and requires user verification.
Cancellation retires its continuation once; account changes cancel/fence pending
prompts before submission. Android retains the flow and account generation across
Credential Manager prompts rather than using mutable global pending-flow state.

Synthetic PostgreSQL tests sign assertions, register attested P-256 credentials,
exercise replay/concurrent counter updates, rollback, RP/origin/signature refusal
and in-flight session revocation. Redis tests cover TTL, concurrent consumption,
wrong purpose/account/session and outages. Native tests exercise wire contracts,
registration and cancellation/account-change fences.

Simulator/unit evidence does not establish signed-device associated-domain trust,
provider availability or accessibility. Physical iOS/Android registration, sign-in,
cancellation and VoiceOver/TalkBack remain release gates.

# Feed fetching

Ordinary RSS refreshes and imports use the bounded transport in
`src/server/ingest/feed-http.ts`. Private ownership does not permit fetching local
or internal-network destinations.

## Transport policy

- HTTP(S) only, without URL credentials. Query parameters, order and escaping are
  retained; private locators never go through public-alias normalization.
- Resolve every hop and reject empty, mixed public/private, local, reserved,
  multicast and non-global IPv6 answers. Connect to the selected IP without a
  second lookup, preserving Host and TLS verification against the original name.
- At most five redirects, without HTTPS-to-HTTP downgrade.
- One 30-second deadline covers DNS, redirects, headers and bodies. Wire and
  decoded bodies are each capped at 32 MiB; headers at 16 KiB. Truncation and
  invalid/unsupported compressed encodings are failures.
- Only application-selected HTTP headers are sent. No cookies or authorization
  are forwarded. ETag and Last-Modified are validated and dropped across origins.
- Conditional 304 responses preserve prior metadata. Unconditional rebuilds
  require a body. Identical bodies still avoid redundant writes.
- Transport and parser failures do not include locators or feed contents.

XML is bounded before object construction: 32 MiB, depth 64, 250,000 elements,
64 attributes per element, 256-character names and 512 KiB attribute values.
DTD/entity/SGML declarations are rejected; declaration-like text inside comments
or CDATA remains text. No external XML resources are loaded.

Chapter metadata retains its separate range/redirect/validator policy. Public
move verification retains its own locator/evidence policy. These callers share
only the applicable DNS, pinned-request, validator and RSS-body primitives.

## Verification and remaining work

Synthetic suites cover private/mixed/IPv6 destinations, pinning and rebinding,
redirects, token preservation, TLS hostname verification, compressed expansion,
chunked limits, stalled lookup/body, truncation, validators and parser limits.
Local integration tests inject a fixture resolver; production has no loopback
switch or environment bypass. Existing publisher fixtures still parse, but this
is not a broad publisher-compatibility survey.

Fetches still run inside refresh/import transactions. Moving that work to durable
claim/fetch/commit leases and agreeing pending/freshness API semantics is a
separate change; bounded transport alone does not solve transaction occupancy.

# Search budgets

Text search reserves one request from both a trusted-source budget and a global
budget before starting Apple or database search work. The rolling 60-second
windows use Redis time and one atomic script. Podcast `GET /api/search`, text
`POST /api/search`, and `GET /api/search/episodes` share both budgets across
application instances and hostnames. Rejected reservations spend neither budget;
admitted work still counts if the downstream search fails.

RSS-link POSTs keep their existing authentication and feed-import admission.
Ordinary text search is public and does not load a user session. Client-supplied
native markers, cookies and arbitrary forwarding headers grant no extra allowance.

## Configuration

Set these on every application instance before deploying this change:

- `SEARCH_SOURCE_PER_MINUTE`: positive integer number of admitted searches per
  trusted source in any rolling minute.
- `SEARCH_GLOBAL_PER_MINUTE`: positive integer number of admitted searches across
  all sources and all three entry points in any rolling minute.
- The existing `AUTH_CODE_SECRET`: at least 32 random bytes encoded as hex. The
  limiter uses it to HMAC source addresses; raw addresses and search terms are not
  stored in its Redis keys or values. Reservations expire after 60 seconds.

There are no default production quotas and no bypass for missing configuration.
Select numerical budgets from ordinary search traffic (including paired podcast
and episode requests), shared-IP usage, upstream capacity and a cost envelope.
The tiny values used in tests are synthetic, not launch recommendations.

Use the same Redis database, secret and quota values across Fly, Vercel and every
other origin serving these routes. `createRedis` uses the existing provider-specific
Redis configuration. Shared ceilings depend on shared authoritative Redis state;
separate caches, eviction or lost state on failover can reset budgets. Validate
that budget keys survive memory pressure and the intended failover behavior.

`AUTH_TRUSTED_IP_HEADER` has the same meaning as in
[email authentication](email-authentication.md): configure it only where ingress
overwrites it with one verified IP and direct header spoofing is prevented.
Missing, malformed or unconfigured source addresses share the `unattributed`
budget. Verify every production/preview/direct origin before relying on source
fairness. A valid account or native header never replaces this source check.

## Responses and scope

Exhaustion returns 429 with `code: rate_limited` and a positive `Retry-After` in
seconds. Invalid configuration or unavailable/malformed Redis state returns 503
with `code: unavailable` and `Retry-After: 5`. Both responses are `private, no-store`
and contain no dependency details. Redis connection and command waits are each
bounded to one second; there is no offline queue, command resend or local fallback.

Successful episode search retains `public, s-maxage=300`. A response served by an
upstream cache does not reach this limiter or start origin search work. Podcast
GET caching is unchanged and POST remains private. A search that reaches the
application consumes a permit even if an internal dependency serves cached data.

These limits bound search starts; they do not cap concurrent in-flight queries,
bound all upstream execution time, meter edge cache hits, or cover other APIs.
Active-work ceilings, the remaining route/origin inventory and native app
attestation remain separate work. No app identity is established by this change.

Removing the new quota variables makes origin text search unavailable. Deploying
an older revision removes these protections, so neither action is a transparent
rollback. This document supplies implementation requirements, not production
configuration or deployment approval.

## Verification

```sh
REQUIRE_LIST_LIMIT_TESTS=1 bun --no-env-file test src/server/search/
```

Tests start disposable local Redis instances. They exercise atomic source/global
ceilings, expiry, two Redis clients, actual route wiring across processes, forged
headers, missing configuration, refused/stalled Redis connections, HTTP errors
and preservation of RSS authentication. External Apple and SQL calls in route
tests are isolated substitutes; they prove work is not started after refusal.

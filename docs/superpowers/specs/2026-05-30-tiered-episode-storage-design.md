# Tiered episode storage — design

Date: 2026-05-30
Status: approved (pending spec review)

## Problem

The `episodes` table on `sixth-1` is 170 GB / 143.9 M rows and grows by
millions of rows/day as the poller ingests every episode of every podcast in
the global catalog. The disk (301 GB) is at ~81%. Left alone it fills in
weeks-to-months and takes Postgres and the poller down.

Of 4.57 M podcasts, only **45 are subscribed** and ~6,253 are charted. We store
the full episode content for all 4.57 M. The stored data tracks the global
podcast universe instead of our users' actual surface area.

Episode *content* (title, summary, art, file URL, duration) is re-derivable
from the feed. The surrogate `id ↔ (podcast_id, guid)` mapping is **not** — it
is a public URL contract (`/episodes/{podcastId}/{episodeId}`) and the FK target
of `playback_progress` and `transcripts`. So ids must be preserved while content
becomes evictable.

## Goal

Bound the catalog's disk footprint to a small, predictable size that follows
real usage, without breaking any episode/podcast id.

- Store content only for podcasts that matter (essential), cache content for
  recently-accessed ones (warm) under a hard cap, and keep only durable ids for
  the rest (cold), serving their content live from the feed on demand.
- Reclaim the ~170 GB now and stop the growth at the source.

Non-goals: changing URL schemes; backing up content (it stays re-derivable);
altering the user-data or id-map backup jobs.

## Tiers

A podcast is in exactly one tier, derived (not stored, except the
`is_essential` projection below):

- **Essential** — pinned, fully indexed, actively polled. Member if **any** of:
  - has ≥ 1 subscriber (`subscriptions`)
  - appears in `top_podcasts` (any chart)
  - has an episode played in the last 90 days (`playback_progress.updated_at`)

  Current size: **6,281 podcasts / 2.07 M episodes / ~2.5 GB**. Never evicted.
  Feed liveness is ignored for membership (a subscribed dead feed stays
  essential; we just stop polling it). Demotion is automatic: when all three
  conditions lapse, the podcast simply stops being essential and its content
  becomes warm.

- **Warm** — has `episode_content` but is not essential. Reached by on-access
  caching (rebuild-on-read). Evictable under a hard **15 GB** cap by LRU on
  `last_accessed_at`. Not polled — refreshed opportunistically on access.

- **Cold** — no `episode_content`. Only durable identity rows. Content fetched
  live from the feed on access (Redis-cached), which promotes it to warm.

`is_active` recency was evaluated as an essential signal and **rejected**: any
publish-recency window pulls in ~2.3 M podcasts / ~100 GB, which defeats the
bound. "Publishes regularly" does not mean "anyone here wants it."

Total stored content target ≈ 2.5 GB essential + ≤ 15 GB warm ≈ **~20 GB**,
down from 170 GB, on a 301 GB disk.

## Schema

`episodes` — identity, durable, never evicted, FK target:

```
id         BIGINT PK            -- keeps episodes_id_seq; all 144M ids retained
podcast_id BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE
guid       TEXT NOT NULL
published  TIMESTAMPTZ NOT NULL -- kept: cheap, sorts cold/evicted lists
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE (podcast_id, guid)
-- idx_episodes_podcast (podcast_id), idx_episodes_published (published DESC)
```

`episode_content` — evictable; its size is what the 15 GB cap measures:

```
episode_id  BIGINT PK REFERENCES episodes(id) ON DELETE CASCADE
title       TEXT NOT NULL
summary     TEXT
duration    INTEGER
episode_art TEXT     -- sparse: stored only when != podcast cover (migration 0007)
file_url    TEXT NOT NULL
file_length BIGINT
file_type   TEXT
```

`podcasts` gains:

```
last_accessed_at TIMESTAMPTZ   -- LRU key, touched on read (+ index)
is_essential     BOOLEAN       -- maintained projection of the essential rule
```

`playback_progress.episode_id` and `transcripts.episode_id` keep referencing
`episodes(id)` — unchanged, since identity retains every id.

`is_essential` is the one deliberately-stored derivation: the poller's hot loop
and the eviction job read it instead of running `EXISTS` subqueries over
millions of rows each cycle. It is recomputed by the tiering job (below) — a
materialized cache of the rule, not an independent source of truth.

## Tiering & eviction job

A systemd timer (hourly) on `sixth-1`:

1. Recompute `podcasts.is_essential` from the three rules.
2. Estimate `episode_content` size for non-essential (warm) podcasts
   (avg bytes/row × row counts — exactness is unnecessary for a cap).
3. While warm content > 15 GB: delete `episode_content` for the non-essential
   podcast with the oldest `last_accessed_at`, until back under the cap.
   Essential podcasts are never eviction candidates.

If essential content ever exceeds the cap (impossible at current scale,
~2.5 GB ≪ 15 GB), log/alert and never evict essential — the cap yields to the
pin.

## Read path

Every podcast/episode page view touches `last_accessed_at` (throttled to ≥ 1h
granularity to avoid write amplification on hot shows). That timestamp is the
LRU signal.

- `getEpisodeById(id)`: `episodes LEFT JOIN episode_content`.
  - Content present → serve.
  - Content absent (cold/evicted) → join `podcasts` for `feed_url`, fetch feed
    (existing Redis 1h cache), match by `guid`, serve. Async: insert
    `episode_content` + touch `last_accessed_at` → promotes to warm. The id is
    unchanged throughout.
- `getEpisodesPaginated(podcastId)`:
  - Has content → serve from DB as today.
  - Cold → fetch feed, render list, mint/match identity rows for the shown
    episodes (so links resolve), store their content → warm.

This generalizes the existing `ingestPodcast(feedUrl)` read-miss path to the
numeric-id paths, keyed on identity rows.

## Write path / poller

- The poller polls only `is_essential` podcasts — from ~4.4 M feeds to ~6.3 K.
  Cold feeds are never scanned or written. Existing `priority` /
  `popularity_score` ordering still applies within essential.
- Upsert splits: identity into `episodes` (on `(podcast_id, guid)`) and content
  into `episode_content` (on `episode_id`).
- Warm podcasts are not polled — refreshed on access, bounded by the Redis feed
  cache TTL.
- Cold episode identity is minted lazily on access only; identity stops growing
  with the whole catalog and grows only with real usage. The existing 144 M
  identity rows are all retained.

## Migration & reclamation (table swap)

Reclaiming 170 GB needs a swap, not `VACUUM FULL` (which would need ~170 GB
free). With the poller stopped:

1. Build `episodes_identity` (id, podcast_id, guid, published, created_at) —
   copy all 144 M rows (~10 GB).
2. Build `episode_content`, populate from current `episodes` for the essential
   set (~2 M rows / ~2.5 GB).
3. One transaction: drop `playback_progress` / `transcripts` FKs → rename
   `episodes` → `episodes_old`, `episodes_identity` → `episodes` → recreate
   indexes / `UNIQUE` / sequence ownership → re-add the two FKs to the new
   `episodes` → add `episode_content` → `episodes` FK. (Rename is metadata-only;
   lock window is seconds.)
4. `DROP TABLE episodes_old` → frees ~170 GB immediately.
5. Add `podcasts.last_accessed_at` + `is_essential`; run the tiering job once.
6. Deploy new read/write code; restart poller.

Peak disk ~243 GB of 301 GB; ends ~70 GB for the DB. Short maintenance window
(poller down, brief query stall during the rename).

**Invariant verified before `DROP TABLE episodes_old`:** every id in
`episodes_old` exists in the new `episodes` (no id lost). The weekly id-map
backup is the safety net.

Phase 0 (optional, recommended): immediate disk relief before migration — drop
the leftover PG 14/17 clusters, cap journald, clear `~/.npm` — for extra
headroom.

## Error handling & edge cases

- Rebuild but feed dead/unreachable: serve identity-only (guid, published,
  podcast info) with a graceful "episode unavailable" via the existing
  `EpisodesNotFound` / `EmptyEpisodesRefresh` components. No crash.
- `last_accessed_at` write storm: throttled to ≥ 1h granularity.
- Evict-during-read race: a request reading content being deleted gets a miss
  → rebuilds. Idempotent, safe.
- Subscribed/charted podcasts are always essential, so `getSubscriptions`'
  "latest 2 episodes" always has content — no subscriber hits a rebuild.

## Testing

- Unit: essential-membership derivation; LRU victim selection under cap;
  rebuild-on-miss (fetch → store → same id).
- Property/invariant: evict then re-access a `(podcast_id, guid)` → identical
  `id`. The id-contract guarantee, tested.
- Integration: subscribe to a cold podcast → becomes essential → polled &
  content present; evicted episode page → content rebuilt, id stable.
- Migration: dry-run on a restored copy — assert id-count parity, FK integrity,
  essential content present, before the real run.

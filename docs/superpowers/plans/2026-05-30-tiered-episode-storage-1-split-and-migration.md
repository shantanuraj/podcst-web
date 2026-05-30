# Tiered Episode Storage — Plan 1: Split, Migration & Growth-Bounding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `episodes` into a durable identity table + an evictable `episode_content` table, migrate the 170 GB table via a table-swap that reclaims the space and preserves every id, adapt all reads/writes to the split (with rebuild-on-read for cold podcasts), and make the poller process only essential podcasts so the catalog stops re-filling.

**Architecture:** `episodes` keeps every id (FK target, durable). `episode_content` holds the heavy columns only for essential + warm podcasts. Reads LEFT JOIN content; on a miss they rebuild from the live feed (generalizing the existing `ingestPodcast` path) keyed on the durable identity row, so ids never change. The poller reads a maintained `podcasts.is_essential` flag and polls only those.

**Tech Stack:** Postgres (porsager `postgres` tagged templates, `src/server/db.ts`), Bun (scripts, `bun test`), Next.js App Router, Redis (ioredis) for the existing feed cache, systemd on host `sixth-1`.

**Scope:** This is Plan 1 of 2. Plan 2 (warm LRU eviction enforcing the 15 GB cap) is a fast-follow — warm content cannot exceed the cap on day one. Spec: `docs/superpowers/specs/2026-05-30-tiered-episode-storage-design.md`.

**Load-bearing facts from the codebase:**
- `episodes` today: `id, podcast_id, guid, title, summary, published, duration, episode_art, file_url, file_length, file_type, created_at`, `UNIQUE(podcast_id, guid)`, indexes `idx_episodes_podcast(podcast_id)`, `idx_episodes_published(published DESC)` (`migrations/0004-episodes-bigint.sql`).
- FKs into `episodes(id)`: `playback_progress_episode_id_fkey`, `transcripts_episode_id_fkey` (both `ON DELETE CASCADE`).
- Content readers (all `SELECT *`/`e.*` from `episodes`): `getPodcastByFeedUrl` (`podcast.ts:208`), `getPodcastById` (`:264`), `getEpisodeById` (`:311`), `getEpisodesPaginated` (`:385`), and `getSubscriptions` (`src/server/subscriptions.ts:28`). `getPodcastInfoById` does NOT read episodes.
- Writer: `upsertEpisodes` (`src/server/ingest/episodes.ts:50`) — `jsonb_to_recordset` UPDATE-if-distinct + INSERT-if-not-exists on `(podcast_id, guid)`.
- Poller batch query: `scripts/poll-feeds.ts:177-195` (`WHERE p.is_active = true AND next_poll_at <= now() ... ORDER BY priority DESC, popularity_score DESC`).
- Migration runner `scripts/migrate.ts` runs raw `.sql` files; **without a filename it re-runs ALL of them**, so one-time heavy operations must be a dedicated script, and schema `.sql` migrations must be idempotent (`IF NOT EXISTS`).
- `episode_art` is sparse: stored only when `!= podcast cover` (`buildRows`, `episodes.ts:41`). This stays in `episode_content`.

---

## Phase 0 — Disk relief on `sixth-1` (do first, buys migration headroom)

### Task 0: Reclaim quick wins before migrating

**Files:** none (ops on `sixth-1`). Run interactively; confirm each before destructive steps.

- [ ] **Step 1: Snapshot current usage**

Run: `ssh sixth-1 'df -h / && pg_lsclusters && journalctl --disk-usage && du -sh ~/.npm'`
Expected: ~81% on `/`; clusters 14/16/17 listed; journal ~1–2 G; `~/.npm` ~6 G.

- [ ] **Step 2: Drop the abandoned PG 14 and 17 clusters (verify 17 is empty first)**

Run: `ssh sixth-1 'sudo -u postgres psql -p 5433 -Atc "SELECT datname,pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname NOT LIKE '\''template%'\''"'`
Expected: only `postgres` (~7 MB) — confirms cluster 17 holds no real data.
Then: `ssh sixth-1 'sudo pg_dropcluster 14 main --stop && sudo pg_dropcluster 17 main --stop'`
Expected: both removed; `pg_lsclusters` now shows only `16 main`.

- [ ] **Step 3: Cap journald and clear the npm cache**

Run: `ssh sixth-1 'sudo journalctl --vacuum-size=200M && npm cache clean --force'`
Expected: journal trimmed to ≤200 M; npm cache emptied.

- [ ] **Step 4: Confirm reclaimed headroom**

Run: `ssh sixth-1 'df -h /'`
Expected: `Avail` increased (target ≥ 70 G free before migration; migration peak adds ~12.5 G).

---

## Phase 1 — Schema additions (idempotent migration)

### Task 1: Add `episode_content`, `last_accessed_at`, `is_essential`

**Files:**
- Create: `migrations/0008-tiered-episodes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0008-tiered-episodes.sql
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS is_essential boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_podcasts_last_accessed ON podcasts(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_podcasts_is_essential ON podcasts(is_essential) WHERE is_essential;

CREATE TABLE IF NOT EXISTS episode_content (
  episode_id  bigint PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  title       text NOT NULL,
  summary     text,
  duration    integer,
  episode_art text,
  file_url    text NOT NULL,
  file_length bigint,
  file_type   text
);
```

- [ ] **Step 2: Apply it (locally / on the target DB) by explicit filename**

Run: `bun scripts/migrate.ts 0008-tiered-episodes.sql`
Expected: `Running 0008-tiered-episodes.sql...` then `✓ 0008-tiered-episodes.sql` then `Done.`

- [ ] **Step 3: Verify objects exist**

Run: `psql "$DATABASE_URL" -Atc "\d episode_content" && psql "$DATABASE_URL" -Atc "SELECT column_name FROM information_schema.columns WHERE table_name='podcasts' AND column_name IN ('last_accessed_at','is_essential')"`
Expected: `episode_content` columns listed; both new podcast columns present.

- [ ] **Step 4: Commit**

```bash
git add migrations/0008-tiered-episodes.sql
git commit -m "feat(db): add episode_content table and podcast tier columns"
```

---

## Phase 2 — Tier derivation (pure, testable)

### Task 2: `is_essential` computation as a reusable query module

**Files:**
- Create: `src/server/tiering.ts`
- Test: `src/server/tiering.test.ts`

The essential rule (spec): a podcast is essential if it has ≥1 subscriber OR appears in `top_podcasts` OR has an episode played in the last 90 days. Encapsulate the SQL so the migration, tiering job, and poller all share one definition (DRY).

- [ ] **Step 1: Write the failing test**

```ts
// src/server/tiering.test.ts
import { expect, test } from 'bun:test';
import { ESSENTIAL_IDS_SQL } from './tiering';

test('essential query references the three signals and nothing else', () => {
  const q = ESSENTIAL_IDS_SQL.toLowerCase();
  expect(q).toContain('from subscriptions');
  expect(q).toContain('from top_podcasts');
  expect(q).toContain('playback_progress');
  expect(q).toContain("interval '90 days'");
  expect(q).not.toContain('is_active');
  expect(q).not.toContain('last_published');
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `bun test src/server/tiering.test.ts`
Expected: FAIL — `Cannot find module './tiering'`.

- [ ] **Step 3: Implement**

```ts
// src/server/tiering.ts
import { sql } from './db';

export const ESSENTIAL_IDS_SQL = `
  SELECT podcast_id AS id FROM subscriptions
  UNION
  SELECT podcast_id AS id FROM top_podcasts
  UNION
  SELECT e.podcast_id AS id
  FROM playback_progress pp
  JOIN episodes e ON e.id = pp.episode_id
  WHERE pp.updated_at > now() - interval '90 days'
`;

export async function recomputeEssential(): Promise<number> {
  const ids = sql.unsafe(ESSENTIAL_IDS_SQL);
  const [{ n }] = await sql`
    WITH ess AS (${ids})
    , upd AS (
      UPDATE podcasts p
      SET is_essential = (p.id IN (SELECT id FROM ess))
      WHERE p.is_essential IS DISTINCT FROM (p.id IN (SELECT id FROM ess))
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upd
  `;
  return n;
}
```

- [ ] **Step 4: Run the unit test, expect pass**

Run: `bun test src/server/tiering.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tiering.ts src/server/tiering.test.ts
git commit -m "feat(tiering): shared essential-podcast definition + recompute"
```

---

## Phase 3 — Adapt the writer to the split

### Task 3: `upsertEpisodes` writes identity to `episodes` and content to `episode_content`

**Files:**
- Modify: `src/server/ingest/episodes.ts:50-91`
- Test: `src/server/ingest/episodes.test.ts`

Identity insert keeps minting ids on `(podcast_id, guid)`. Content is upserted by `episode_id`, resolved from the identity rows just written. Keep the sparse-art and dedupe logic in `buildRows` unchanged.

- [ ] **Step 1: Write the failing test for `buildRows` invariants (pure)**

```ts
// src/server/ingest/episodes.test.ts
import { expect, test } from 'bun:test';
import { buildRows } from './episodes';

const ep = (over = {}) => ({
  guid: 'g1', title: 'T', showNotes: 'S', published: '2020-01-01',
  duration: 60, episodeArt: 'art', file: { url: 'u', length: 1, type: 'audio/mpeg' },
  ...over,
});

test('drops rows without guid or file url', () => {
  expect(buildRows([ep({ guid: null })] as any, null)).toHaveLength(0);
  expect(buildRows([ep({ file: { url: null } })] as any, null)).toHaveLength(0);
});

test('art stored only when different from cover', () => {
  expect(buildRows([ep({ episodeArt: 'cover' })] as any, 'cover')[0].episode_art).toBeNull();
  expect(buildRows([ep({ episodeArt: 'other' })] as any, 'cover')[0].episode_art).toBe('other');
});
```

(`buildRows` is currently un-exported — Step 3 exports it.)

- [ ] **Step 2: Run, expect fail**

Run: `bun test src/server/ingest/episodes.test.ts`
Expected: FAIL — `buildRows` is not exported.

- [ ] **Step 3: Export `buildRows` and rewrite `upsertEpisodes`**

In `src/server/ingest/episodes.ts`, change `const buildRows` to `export const buildRows`, then replace the body of `upsertEpisodes` (lines 56-90) with:

```ts
  const rows = buildRows(episodes, podcastCover);
  if (rows.length === 0) return;

  const ids = sql.json(rows.map((r) => r.guid) as unknown as postgres.JSONValue);

  await sql`
    INSERT INTO episodes (podcast_id, guid, published)
    SELECT ${podcastId}, d.guid, d.published
    FROM jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}::jsonb)
         AS d(guid text, published timestamptz)
    ON CONFLICT (podcast_id, guid) DO NOTHING
  `;

  await sql`
    INSERT INTO episode_content (
      episode_id, title, summary, duration, episode_art, file_url, file_length, file_type
    )
    SELECT e.id, d.title, d.summary, d.duration, d.episode_art, d.file_url, d.file_length, d.file_type
    FROM jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}::jsonb) AS d(
      guid text, title text, summary text, duration int,
      episode_art text, file_url text, file_length bigint, file_type text
    )
    JOIN episodes e ON e.podcast_id = ${podcastId} AND e.guid = d.guid
    ON CONFLICT (episode_id) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      duration = EXCLUDED.duration,
      episode_art = EXCLUDED.episode_art,
      file_url = EXCLUDED.file_url,
      file_length = EXCLUDED.file_length,
      file_type = EXCLUDED.file_type
    WHERE (episode_content.title, episode_content.summary, episode_content.duration,
           episode_content.episode_art, episode_content.file_url,
           episode_content.file_length, episode_content.file_type)
      IS DISTINCT FROM
          (EXCLUDED.title, EXCLUDED.summary, EXCLUDED.duration,
           EXCLUDED.episode_art, EXCLUDED.file_url,
           EXCLUDED.file_length, EXCLUDED.file_type)
  `;
```

Remove the now-unused `ids` line if not referenced. (`published` is written on identity insert only, matching today's insert-only semantics for `published`.)

- [ ] **Step 4: Run the unit test, expect pass**

Run: `bun test src/server/ingest/episodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Integration check against a scratch DB**

With `DATABASE_URL` pointing at a local Postgres that has run migrations `0000`–`0008`:
Run: `bun -e "import {sql} from './src/server/db'; import {upsertEpisodes} from './src/server/ingest/episodes'; await sql\`INSERT INTO podcasts (id,feed_url,title,author_id) VALUES (1,'f','t',1) ON CONFLICT DO NOTHING\`; await upsertEpisodes(sql,1,'cover',[{guid:'g',title:'T',showNotes:'S',published:'2020-01-01',duration:1,episodeArt:'a',file:{url:'u',length:1,type:'audio/mpeg'}}] as any); const r=await sql\`SELECT e.id,c.title FROM episodes e JOIN episode_content c ON c.episode_id=e.id WHERE e.podcast_id=1\`; console.log(r); process.exit(0)"`
Expected: one row with a numeric `id` and `title: 'T'` — identity + content both written, joined by id.

- [ ] **Step 6: Commit**

```bash
git add src/server/ingest/episodes.ts src/server/ingest/episodes.test.ts
git commit -m "feat(ingest): split episode upsert into identity + content"
```

---

## Phase 4 — Adapt readers + rebuild-on-read

### Task 4: A single `episodeContentRows` helper (DRY for all readers)

**Files:**
- Create: `src/server/ingest/episode-read.ts`
- Test: `src/server/ingest/episode-read.test.ts`

All readers need the same shape: identity LEFT JOIN content, and when content is missing for a podcast, rebuild from the feed once, then re-read. Centralize "does this podcast have content, and rebuild if not" so each reader stays small.

- [ ] **Step 1: Write the failing test (rebuild decision is pure, deps injected)**

```ts
// src/server/ingest/episode-read.test.ts
import { expect, test } from 'bun:test';
import { needsRebuild } from './episode-read';

test('rebuild when zero content rows for a podcast that has identity rows', () => {
  expect(needsRebuild({ identityCount: 12, contentCount: 0 })).toBe(true);
});
test('no rebuild when content present', () => {
  expect(needsRebuild({ identityCount: 12, contentCount: 12 })).toBe(false);
});
test('no rebuild when podcast has no episodes at all', () => {
  expect(needsRebuild({ identityCount: 0, contentCount: 0 })).toBe(false);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `bun test src/server/ingest/episode-read.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper + rebuild trigger**

```ts
// src/server/ingest/episode-read.ts
import { sql } from '../db';

export function needsRebuild(c: { identityCount: number; contentCount: number }): boolean {
  return c.identityCount > 0 && c.contentCount === 0;
}

export async function touchAccess(podcastId: number): Promise<void> {
  await sql`
    UPDATE podcasts
    SET last_accessed_at = now()
    WHERE id = ${podcastId}
      AND (last_accessed_at IS NULL OR last_accessed_at < now() - interval '1 hour')
  `;
}

export async function ensureContent(podcastId: number, feedUrl: string): Promise<void> {
  const [{ identity_count, content_count }] = await sql`
    SELECT
      (SELECT count(*) FROM episodes WHERE podcast_id = ${podcastId})::int AS identity_count,
      (SELECT count(*) FROM episode_content c JOIN episodes e ON e.id = c.episode_id
        WHERE e.podcast_id = ${podcastId})::int AS content_count
  `;
  if (needsRebuild({ identityCount: identity_count, contentCount: content_count })) {
    const { refreshPodcast } = await import('./podcast');
    await refreshPodcast(podcastId);
  }
}
```

(`refreshPodcast` already fetches the feed and calls `upsertEpisodes`, which now writes content onto the existing identity rows — ids preserved. Imported lazily to avoid a cycle.)

- [ ] **Step 4: Run unit test, expect pass**

Run: `bun test src/server/ingest/episode-read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/episode-read.ts src/server/ingest/episode-read.test.ts
git commit -m "feat(read): content-presence helper + rebuild-on-read trigger"
```

### Task 5: Point every episode reader at `episode_content` (+ rebuild + touch)

**Files:**
- Modify: `src/server/ingest/podcast.ts` — `getPodcastByFeedUrl` (`:208-212`), `getPodcastById` (`:264-268`), `getEpisodeById` (`:311-318`), `getEpisodesPaginated` (every `SELECT * FROM episodes`, `:414-540`)
- Modify: `src/server/subscriptions.ts:28-44`

The mechanical change in each query: `SELECT *` over `episodes` becomes a `LEFT JOIN episode_content c ON c.episode_id = e.id`, selecting `e.id, e.guid, e.published, c.title, c.summary, c.duration, c.episode_art, c.file_url, c.file_length, c.file_type`. The result-mapping code that reads `ep.title`, `ep.file_url`, etc. is unchanged because the column names are identical — only their source table changed. `getEpisodeById` already aliases `e.*`; switch to explicit columns from the join.

- [ ] **Step 1: Write the failing integration test (evicted episode rebuilds, id stable)**

```ts
// src/server/ingest/episode-read.integration.test.ts
import { expect, test } from 'bun:test';
import { sql } from '../db';
import { getEpisodeById } from './podcast';

test('reading an episode whose content was evicted rebuilds it with the same id', async () => {
  const [{ id: pid }] = await sql`
    INSERT INTO podcasts (feed_url, title, author_id)
    VALUES ('https://feeds.simplecast.com/54nAGcIl', 'Test', 1)
    ON CONFLICT (feed_url) DO UPDATE SET title = EXCLUDED.title RETURNING id`;
  const { refreshPodcast } = await import('./podcast');
  await refreshPodcast(pid);
  const [{ id: eid }] = await sql`SELECT id FROM episodes WHERE podcast_id = ${pid} ORDER BY published DESC LIMIT 1`;

  await sql`DELETE FROM episode_content WHERE episode_id = ${eid}`; // simulate eviction

  const ep = await getEpisodeById(eid);
  expect(ep).not.toBeNull();
  expect(ep!.id).toBe(Number(eid));        // id preserved
  expect(ep!.title).toBeTruthy();          // content rebuilt from feed
  await sql`DELETE FROM podcasts WHERE id = ${pid}`;
});
```

(Requires `DATABASE_URL` → scratch Postgres with migrations applied and network access to the feed. Document this in the test header.)

- [ ] **Step 2: Run, expect fail**

Run: `bun test src/server/ingest/episode-read.integration.test.ts`
Expected: FAIL — `getEpisodeById` returns null title (content gone, no rebuild yet).

- [ ] **Step 3a: Rewrite `getEpisodeById` (`podcast.ts:311-318`)**

```ts
  const [row] = await sql`
    SELECT e.id, e.guid, e.published, e.podcast_id,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type,
           p.feed_url, p.title as podcast_title, p.cover as podcast_cover,
           p.explicit as podcast_explicit, a.name as author_name
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN authors a ON a.id = p.author_id
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.id = ${episodeId}
  `;
  if (!row) return null;
  if (row.file_url == null) {
    const { ensureContent } = await import('./episode-read');
    await ensureContent(row.podcast_id, row.feed_url);
    return getEpisodeById(episodeId); // re-read once after rebuild
  }
```

(Keep the existing return-mapping block below unchanged — it reads the same field names.)

- [ ] **Step 3b: Rewrite the list readers**

For `getPodcastByFeedUrl` (`:208`) and `getPodcastById` (`:264`), replace the `SELECT * FROM episodes WHERE podcast_id = ${podcast.id} ORDER BY published DESC` with:

```ts
  await (await import('./episode-read')).touchAccess(podcast.id);
  await (await import('./episode-read')).ensureContent(podcast.id, podcast.feed_url);
  const episodes = await sql`
    SELECT e.id, e.guid, e.published,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type
    FROM episodes e
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.podcast_id = ${podcast.id}
    ORDER BY e.published DESC
  `;
```

For `getEpisodesPaginated` (`:414-540`): add `await touchAccess(podcastId)` and `await ensureContent(podcastId, podcast.feed_url)` after the `podcast` lookup (`:406`), and in every `SELECT * FROM episodes` change to `SELECT e.id, e.guid, e.published, c.title, c.summary, c.duration, c.episode_art, c.file_url, c.file_length, c.file_type FROM episodes e LEFT JOIN episode_content c ON c.episode_id = e.id`, with `e.podcast_id`, and the `ILIKE` search predicates referencing `c.title`/`c.summary`. The `ORDER BY` columns become `e.published`, `c.title`, `c.duration`. (Search over evicted content is best-effort; after `ensureContent` the page's podcast is warm so content is present.)

- [ ] **Step 3c: Rewrite `getSubscriptions` (`subscriptions.ts:28-44`)**

Change its episode subquery to `LEFT JOIN episode_content`. Subscribed podcasts are always essential (content present), so no rebuild is needed here — just the join:

```ts
    SELECT e.id, e.guid, e.published,
           c.title, c.summary, c.duration, c.episode_art,
           c.file_url, c.file_length, c.file_type
    FROM episodes e
    LEFT JOIN episode_content c ON c.episode_id = e.id
    WHERE e.podcast_id = ${podcastId}
    ORDER BY e.published DESC
    LIMIT 2
```

- [ ] **Step 4: Run integration test, expect pass**

Run: `bun test src/server/ingest/episode-read.integration.test.ts`
Expected: PASS — id preserved, title rebuilt.

- [ ] **Step 5: Typecheck + build**

Run: `yarn lint && yarn build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/server/ingest/podcast.ts src/server/subscriptions.ts
git commit -m "feat(read): serve episode content via episode_content with rebuild-on-read"
```

---

## Phase 5 — Poller polls only essential

### Task 6: Restrict the poll batch to `is_essential`

**Files:**
- Modify: `scripts/poll-feeds.ts:177-195` (the `processBatch` SELECT)

- [ ] **Step 1: Add the predicate**

In the `WHERE` clause of the batch query, add `AND p.is_essential = true` alongside the existing `p.is_active = true` and `next_poll_at` conditions. Leave ordering (`priority DESC, popularity_score DESC`) unchanged.

- [ ] **Step 2: Verify the query shape (no full-catalog scan)**

Run: `psql "$DATABASE_URL" -Atc "EXPLAIN SELECT p.id FROM podcasts p JOIN feed_poll_state s ON s.podcast_id=p.id WHERE p.is_active AND p.is_essential AND (s.next_poll_at <= now() OR s.next_poll_at IS NULL) LIMIT 500"`
Expected: plan uses `idx_podcasts_is_essential` (partial index), not a 4.5 M-row seq scan.

- [ ] **Step 3: Commit**

```bash
git add scripts/poll-feeds.ts
git commit -m "feat(poller): poll only essential podcasts"
```

### Task 7: Tiering refresh job + systemd timer

**Files:**
- Create: `scripts/refresh-tiers.ts`
- Create: `scripts/podcst-tiers.service`, `scripts/podcst-tiers.timer`

- [ ] **Step 1: Write the job**

```ts
// scripts/refresh-tiers.ts
import { sql } from '@/server/db';
import { recomputeEssential } from '@/server/tiering';

const changed = await recomputeEssential();
console.log(`is_essential updated for ${changed} podcasts`);
await sql.end();
```

- [ ] **Step 2: Run it against the DB**

Run: `bun scripts/refresh-tiers.ts`
Expected: `is_essential updated for N podcasts` (first run ≈ 6,281 set true).

- [ ] **Step 3: Verify the essential count matches the spec analysis**

Run: `psql "$DATABASE_URL" -Atc "SELECT count(*) FROM podcasts WHERE is_essential"`
Expected: ~6,281 (subscribed ∪ charted ∪ played-90d).

- [ ] **Step 4: Write the systemd units (mirror `scripts/podcst-poller.service` conventions)**

```ini
# scripts/podcst-tiers.service
[Unit]
Description=Podcst tier recompute (is_essential)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
User=shantanu
Group=shantanu
EnvironmentFile=/home/shantanu/src/shantanuraj/podcst-web/.env.local
ExecStart=/home/shantanu/.bun/bin/bun run /home/shantanu/src/shantanuraj/podcst-web/scripts/refresh-tiers.ts
WorkingDirectory=/home/shantanu/src/shantanuraj/podcst-web
```

```ini
# scripts/podcst-tiers.timer
[Unit]
Description=Hourly Podcst tier recompute

[Timer]
OnCalendar=*-*-* *:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh-tiers.ts scripts/podcst-tiers.service scripts/podcst-tiers.timer
git commit -m "feat(tiering): hourly is_essential refresh job + timer"
```

---

## Phase 6 — The offline migration / table swap (run on `sixth-1`, poller stopped)

### Task 8: One-time migration script

**Files:**
- Create: `scripts/migrate-tiered-episodes.sql` (run by hand via `psql`, NOT through `scripts/migrate.ts`)

This reclaims the 170 GB. It assumes Tasks 1 (schema) and the new code are deployed but the **poller is stopped** and the swap runs in a maintenance window. The id-map weekly backup is the safety net.

- [ ] **Step 1: Write the script**

```sql
-- scripts/migrate-tiered-episodes.sql  (run manually, poller stopped)
\set ON_ERROR_STOP on

-- 1. Seed tier flags from the live rules.
UPDATE podcasts p SET is_essential = true
WHERE p.id IN (
  SELECT podcast_id FROM subscriptions
  UNION SELECT podcast_id FROM top_podcasts
  UNION SELECT e.podcast_id FROM playback_progress pp JOIN episodes e ON e.id = pp.episode_id
        WHERE pp.updated_at > now() - interval '90 days'
);

-- 2. Build the durable identity table (all ids).
CREATE TABLE episodes_identity (
  id bigint NOT NULL,
  podcast_id bigint NOT NULL,
  guid text NOT NULL,
  published timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
INSERT INTO episodes_identity (id, podcast_id, guid, published, created_at)
  SELECT id, podcast_id, guid, published, created_at FROM episodes;

-- 3. Populate content for essential podcasts only.
INSERT INTO episode_content (episode_id, title, summary, duration, episode_art, file_url, file_length, file_type)
  SELECT e.id, e.title, e.summary, e.duration, e.episode_art, e.file_url, e.file_length, e.file_type
  FROM episodes e
  WHERE e.podcast_id IN (SELECT id FROM podcasts WHERE is_essential);

-- 4. Index the identity table.
ALTER TABLE episodes_identity ADD PRIMARY KEY (id);
ALTER TABLE episodes_identity ADD CONSTRAINT episodes_podcast_id_guid_key UNIQUE (podcast_id, guid);
CREATE INDEX idx_episodes_podcast ON episodes_identity(podcast_id);
CREATE INDEX idx_episodes_published ON episodes_identity(published DESC);

-- 5. Parity gate — abort if any id would be lost.
DO $$
DECLARE old_n bigint; new_n bigint; old_max bigint; new_max bigint;
BEGIN
  SELECT count(*), max(id) INTO old_n, old_max FROM episodes;
  SELECT count(*), max(id) INTO new_n, new_max FROM episodes_identity;
  IF old_n <> new_n OR old_max <> new_max THEN
    RAISE EXCEPTION 'identity parity failed: old(%,%) new(%,%)', old_n, old_max, new_n, new_max;
  END IF;
END $$;

-- 6. Swap, repoint FKs, fix sequence — atomic.
BEGIN;
  ALTER TABLE playback_progress DROP CONSTRAINT playback_progress_episode_id_fkey;
  ALTER TABLE transcripts DROP CONSTRAINT transcripts_episode_id_fkey;
  ALTER TABLE episodes RENAME TO episodes_old;
  ALTER TABLE episodes_identity RENAME TO episodes;
  ALTER SEQUENCE episodes_id_seq OWNED BY episodes.id;
  ALTER TABLE episodes ALTER COLUMN id SET DEFAULT nextval('episodes_id_seq');
  SELECT setval('episodes_id_seq', (SELECT max(id) FROM episodes));
  ALTER TABLE episodes ADD CONSTRAINT episodes_podcast_id_fkey
    FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;
  ALTER TABLE playback_progress ADD CONSTRAINT playback_progress_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
  ALTER TABLE transcripts ADD CONSTRAINT transcripts_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
  ALTER TABLE episode_content ADD CONSTRAINT episode_content_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
COMMIT;
```

- [ ] **Step 2: Dry-run on a restored copy first**

Restore the latest user-data + id-map context onto a scratch Postgres (or a `pg_dump` of a sample), run the script, and confirm it completes through the parity gate without raising. Document the scratch DB used.
Expected: no exception; `episodes` (identity) row count == pre-swap; `episode_content` ≈ 2 M rows.

- [ ] **Step 3: Production run (maintenance window)**

```bash
ssh sixth-1 'sudo systemctl stop podcst-poller.service'
ssh sixth-1 'sudo -u postgres psql -p 5432 -d podcst -f /home/shantanu/src/shantanuraj/podcst-web/scripts/migrate-tiered-episodes.sql'
```
Expected: runs to `COMMIT`; no parity exception.

- [ ] **Step 4: Smoke-test reads BEFORE dropping the old table**

Hit an essential podcast page and a cold podcast page (rebuild path) on the deployed app; confirm both render and ids in URLs are unchanged.
Expected: essential serves from DB; cold rebuilds from feed; no 500s.

- [ ] **Step 5: Reclaim — drop the old table**

Run: `ssh sixth-1 'sudo -u postgres psql -p 5432 -d podcst -c "DROP TABLE episodes_old"'`
Then: `ssh sixth-1 'df -h /'`
Expected: `/` drops by ~170 G.

- [ ] **Step 6: Restart the poller (now polling only essential) + enable the tier timer**

```bash
ssh sixth-1 'sudo cp scripts/podcst-tiers.service scripts/podcst-tiers.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now podcst-tiers.timer && sudo systemctl start podcst-poller.service'
```
Expected: poller running; `systemctl list-timers podcst-tiers.timer` shows next run.

- [ ] **Step 7: Commit the migration script**

```bash
git add scripts/migrate-tiered-episodes.sql
git commit -m "feat(db): one-time tiered-episodes table swap migration"
```

---

## Self-review (completed)

- **Spec coverage:** schema split (Task 1), tier rules incl. dropping `is_active` (Task 2), writer split (Task 3), rebuild-on-read + `last_accessed_at` (Tasks 4–5), poller-only-essential (Task 6), tiering job (Task 7), table-swap reclamation with id-parity gate (Task 8), disk relief (Task 0). Warm LRU eviction + 15 GB cap → **Plan 2** (out of scope here, by design). Error-handling for dead feeds on rebuild relies on existing `EpisodesNotFound`/`EmptyEpisodesRefresh` UI and `refreshPodcast` returning null — surfaced in Plan 2's hardening if needed.
- **Placeholder scan:** none — every code/SQL step is concrete.
- **Type/name consistency:** `episode_content(episode_id, title, summary, duration, episode_art, file_url, file_length, file_type)` used identically in Tasks 1, 3, 5, 8; `recomputeEssential`/`ESSENTIAL_IDS_SQL` (Task 2) reused in Tasks 7 and 8 share the same rule; `ensureContent`/`touchAccess`/`needsRebuild` (Task 4) used consistently in Task 5.

## Open risk to flag at execution

- The identity copy (Step 2 of Task 8) of 144 M rows runs inside the maintenance window with the poller stopped; estimate 10–20 min. If a shorter window is required, build `episodes_identity` online first and add a catch-up `INSERT ... WHERE id > (max already copied)` immediately before the swap — note this variant but prefer the simpler stop-the-poller approach.

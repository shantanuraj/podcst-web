#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const PODCAST_INDEX_URL = 'https://public.podcastindex.org/podcastindex_feeds.db.tgz';
const TEMP_DIR = join(process.cwd(), '.tmp');
const TGZ_PATH = join(TEMP_DIR, 'podcastindex_feeds.db.tgz');
const DB_PATH = join(TEMP_DIR, 'podcastindex_feeds.db');

const BATCH_SIZE = 1000;

interface PodcastIndexRow {
  id: number;
  url: string;
  title: string;
  lastUpdate: number | null;
  link: string;
  dead: number;
  itunesId: number | null;
  itunesAuthor: string;
  explicit: number;
  imageUrl: string;
  newestItemPubdate: number | null;
  language: string;
  episodeCount: number | null;
  popularityScore: number | null;
  priority: number | null;
  updateFrequency: number | null;
  description: string;
}

async function downloadAndExtract(): Promise<void> {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  console.log('Downloading Podcast Index database...');
  const response = await fetch(PODCAST_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(TGZ_PATH, buffer);
  console.log(`Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  console.log('Extracting...');
  const proc = Bun.spawn(['tar', '-xzf', TGZ_PATH, '-C', TEMP_DIR], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error('Failed to extract archive');
  }
}

async function getLastSyncTime(sql: postgres.Sql): Promise<Date | null> {
  const [row] = await sql`
    SELECT MAX(updated_at) as last_sync FROM podcasts WHERE podcast_index_id IS NOT NULL
  `;
  return row?.last_sync ? new Date(row.last_sync) : null;
}

async function ensureAuthor(sql: postgres.Sql, name: string): Promise<number> {
  const [existing] = await sql`
    SELECT id FROM authors WHERE name = ${name}
  `;
  if (existing) return existing.id;

  const [created] = await sql`
    INSERT INTO authors (name) VALUES (${name})
    ON CONFLICT (itunes_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  return created.id;
}

async function syncBatch(
  sql: postgres.Sql,
  batch: PodcastIndexRow[],
  authorCache: Map<string, number>,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const row of batch) {
    const authorName = row.itunesAuthor || 'Unknown';
    let authorId = authorCache.get(authorName);
    if (!authorId) {
      authorId = await ensureAuthor(sql, authorName);
      authorCache.set(authorName, authorId);
    }

    const lastPublished = row.newestItemPubdate
      ? new Date(row.newestItemPubdate * 1000)
      : null;

    const [result] = await sql`
      INSERT INTO podcasts (
        podcast_index_id,
        itunes_id,
        feed_url,
        title,
        author_id,
        description,
        cover,
        website_url,
        explicit,
        episode_count,
        last_published,
        is_active,
        language,
        popularity_score,
        priority,
        update_frequency,
        updated_at
      ) VALUES (
        ${row.id},
        ${row.itunesId},
        ${row.url},
        ${row.title},
        ${authorId},
        ${row.description || null},
        ${row.imageUrl || 'https://podcst.app/placeholder.png'},
        ${row.link || null},
        ${row.explicit === 1},
        ${row.episodeCount || 0},
        ${lastPublished},
        ${row.dead !== 1},
        ${row.language || null},
        ${row.popularityScore},
        ${row.priority},
        ${row.updateFrequency},
        now()
      )
      ON CONFLICT (podcast_index_id) DO UPDATE SET
        itunes_id = COALESCE(EXCLUDED.itunes_id, podcasts.itunes_id),
        feed_url = EXCLUDED.feed_url,
        title = EXCLUDED.title,
        author_id = EXCLUDED.author_id,
        description = COALESCE(EXCLUDED.description, podcasts.description),
        cover = CASE WHEN EXCLUDED.cover != 'https://podcst.app/placeholder.png' THEN EXCLUDED.cover ELSE podcasts.cover END,
        website_url = COALESCE(EXCLUDED.website_url, podcasts.website_url),
        explicit = EXCLUDED.explicit,
        episode_count = GREATEST(EXCLUDED.episode_count, podcasts.episode_count),
        last_published = GREATEST(EXCLUDED.last_published, podcasts.last_published),
        is_active = EXCLUDED.is_active,
        language = COALESCE(EXCLUDED.language, podcasts.language),
        popularity_score = EXCLUDED.popularity_score,
        priority = EXCLUDED.priority,
        update_frequency = EXCLUDED.update_frequency,
        updated_at = now()
      RETURNING (xmax = 0) as is_insert
    `;

    if (result.is_insert) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated };
}

async function sync(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  await downloadAndExtract();

  console.log('Opening SQLite database...');
  const sqlite = new Database(DB_PATH, { readonly: true });

  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
  });

  const lastSync = await getLastSyncTime(sql);
  console.log(lastSync ? `Last sync: ${lastSync.toISOString()}` : 'First sync');

  const lastSyncUnix = lastSync ? Math.floor(lastSync.getTime() / 1000) : 0;

  const countQuery = sqlite.query<{ count: number }, { $lastSync: number }>(`
    SELECT COUNT(*) as count FROM podcasts
    WHERE lastUpdate > $lastSync OR $lastSync = 0
  `);
  const { count: totalCount } = countQuery.get({ $lastSync: lastSyncUnix })!;
  console.log(`Found ${totalCount.toLocaleString()} podcasts to sync`);

  if (totalCount === 0) {
    console.log('Nothing to sync');
    sqlite.close();
    await sql.end();
    cleanup();
    return;
  }

  const selectQuery = sqlite.query<PodcastIndexRow, { $lastSync: number; $limit: number; $offset: number }>(`
    SELECT
      id, url, title, lastUpdate, link, dead, itunesId, itunesAuthor,
      explicit, imageUrl, newestItemPubdate, language, episodeCount,
      popularityScore, priority, updateFrequency, description
    FROM podcasts
    WHERE lastUpdate > $lastSync OR $lastSync = 0
    ORDER BY popularityScore DESC NULLS LAST
    LIMIT $limit OFFSET $offset
  `);

  const authorCache = new Map<string, number>();
  let processed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let offset = 0;

  while (processed < totalCount) {
    const batch = selectQuery.all({ $lastSync: lastSyncUnix, $limit: BATCH_SIZE, $offset: offset });
    if (batch.length === 0) break;

    const { inserted, updated } = await syncBatch(sql, batch, authorCache);
    totalInserted += inserted;
    totalUpdated += updated;
    processed += batch.length;
    offset += BATCH_SIZE;

    const percent = ((processed / totalCount) * 100).toFixed(1);
    console.log(`Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%)`);
  }

  console.log(`\nSync complete:`);
  console.log(`  Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Updated: ${totalUpdated.toLocaleString()}`);

  sqlite.close();
  await sql.end();
  cleanup();
}

function cleanup(): void {
  console.log('Cleaning up...');
  if (existsSync(TGZ_PATH)) unlinkSync(TGZ_PATH);
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
}

sync().catch((err) => {
  console.error('Sync failed:', err);
  cleanup();
  process.exit(1);
});

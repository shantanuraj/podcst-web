#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import postgres from 'postgres';

const PODCAST_INDEX_URL = 'https://public.podcastindex.org/podcastindex_feeds.db.tgz';
const TEMP_DIR = join(process.cwd(), '.tmp');
const DEFAULT_TGZ_PATH = join(TEMP_DIR, 'podcastindex_feeds.db.tgz');

const BATCH_SIZE = 1000;

const localPath = process.argv[2];

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

async function downloadAndExtract(): Promise<string> {
  const tgzPath = localPath || DEFAULT_TGZ_PATH;
  const extractDir = localPath ? dirname(localPath) : TEMP_DIR;
  const dbPath = join(extractDir, 'podcastindex_feeds.db');

  if (existsSync(dbPath)) {
    console.log(`Using existing database: ${dbPath}`);
    return dbPath;
  }

  if (localPath) {
    if (!existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }
    console.log(`Using local archive: ${localPath}`);
  } else {
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true });
    }

    console.log('Downloading Podcast Index database...');
    const response = await fetch(PODCAST_INDEX_URL);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await Bun.write(tgzPath, buffer);
    console.log(`Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log('Extracting...');
  const proc = Bun.spawn(['tar', '-xzf', tgzPath, '-C', extractDir], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error('Failed to extract archive');
  }

  return dbPath;
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
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of batch) {
    try {
      const authorName = row.itunesAuthor || 'Unknown';
      let authorId = authorCache.get(authorName);
      if (!authorId) {
        authorId = await ensureAuthor(sql, authorName);
        authorCache.set(authorName, authorId);
      }

      const lastPublished = row.newestItemPubdate
        ? new Date(row.newestItemPubdate * 1000)
        : null;

      const [existing] = await sql`
        SELECT id, podcast_index_id FROM podcasts
        WHERE feed_url = ${row.url}
           OR (itunes_id = ${row.itunesId} AND ${row.itunesId} IS NOT NULL)
           OR podcast_index_id = ${row.id}
        LIMIT 1
      `;

      if (existing) {
        await sql`
          UPDATE podcasts SET
            podcast_index_id = ${row.id},
            itunes_id = COALESCE(${row.itunesId}, itunes_id),
            feed_url = ${row.url},
            title = ${row.title},
            author_id = ${authorId},
            description = COALESCE(${row.description || null}, description),
            cover = CASE WHEN ${row.imageUrl || ''} != '' AND ${row.imageUrl || ''} != 'https://podcst.app/placeholder.png' THEN ${row.imageUrl} ELSE cover END,
            website_url = COALESCE(${row.link || null}, website_url),
            explicit = ${row.explicit === 1},
            episode_count = GREATEST(${row.episodeCount || 0}, episode_count),
            last_published = GREATEST(${lastPublished}, last_published),
            is_active = ${row.dead !== 1},
            language = COALESCE(${row.language || null}, language),
            popularity_score = ${row.popularityScore},
            priority = ${row.priority},
            update_frequency = ${row.updateFrequency},
            updated_at = now()
          WHERE id = ${existing.id}
        `;
        updated++;
      } else {
        await sql`
          INSERT INTO podcasts (
            podcast_index_id, itunes_id, feed_url, title, author_id, description,
            cover, website_url, explicit, episode_count, last_published,
            is_active, language, popularity_score, priority, update_frequency, updated_at
          ) VALUES (
            ${row.id}, ${row.itunesId}, ${row.url}, ${row.title}, ${authorId},
            ${row.description || null}, ${row.imageUrl || 'https://podcst.app/placeholder.png'},
            ${row.link || null}, ${row.explicit === 1}, ${row.episodeCount || 0},
            ${lastPublished}, ${row.dead !== 1}, ${row.language || null},
            ${row.popularityScore}, ${row.priority}, ${row.updateFrequency}, now()
          )
        `;
        inserted++;
      }
    } catch (err) {
      skipped++;
    }
  }

  return { inserted, updated, skipped };
}

async function sync(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const dbPath = await downloadAndExtract();

  console.log('Opening SQLite database...');
  const sqlite = new Database(dbPath, { readonly: true });

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
    if (!localPath) cleanup();
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
  let totalSkipped = 0;
  let offset = 0;

  while (processed < totalCount) {
    const batch = selectQuery.all({ $lastSync: lastSyncUnix, $limit: BATCH_SIZE, $offset: offset });
    if (batch.length === 0) break;

    const { inserted, updated, skipped } = await syncBatch(sql, batch, authorCache);
    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;
    processed += batch.length;
    offset += BATCH_SIZE;

    const percent = ((processed / totalCount) * 100).toFixed(1);
    console.log(`Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%)`);
  }

  console.log(`\nSync complete:`);
  console.log(`  Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Updated: ${totalUpdated.toLocaleString()}`);
  console.log(`  Skipped: ${totalSkipped.toLocaleString()}`);

  sqlite.close();
  await sql.end();

  if (!localPath) {
    cleanup();
  }
}

function cleanup(): void {
  console.log('Cleaning up...');
  const tgzPath = DEFAULT_TGZ_PATH;
  const dbPath = join(TEMP_DIR, 'podcastindex_feeds.db');
  if (existsSync(tgzPath)) unlinkSync(tgzPath);
  if (existsSync(dbPath)) unlinkSync(dbPath);
}

sync().catch((err) => {
  console.error('Sync failed:', err);
  cleanup();
  process.exit(1);
});

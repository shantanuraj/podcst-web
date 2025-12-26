#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import postgres from 'postgres';

interface LogEntry {
  timestamp: string;
  action: 'inserted' | 'updated' | 'skipped';
  itunes_id: number | null;
  name: string;
  podcast_index_id: number;
  feed_url: string;
  error?: string;
}

let logFilePath: string;

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

function initLogFile(): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = join(TEMP_DIR, `sync-log-${timestamp}.jsonl`);

  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  writeFileSync(logFilePath, '');
  console.log(`Action log: ${logFilePath}`);
}

function logAction(entry: LogEntry): void {
  appendFileSync(logFilePath, JSON.stringify(entry) + '\n');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
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
  isFirstSync: boolean,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of batch) {
    const itunesId = row.itunesId || null;
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

      if (isFirstSync) {
        const [existing] = await sql`
          SELECT id FROM podcasts
          WHERE feed_url = ${row.url}
             OR (itunes_id = ${itunesId}::INTEGER AND ${itunesId}::INTEGER IS NOT NULL)
             OR podcast_index_id = ${row.id}
          LIMIT 1
        `;

        if (existing) {
          await sql`
            UPDATE podcasts SET
              podcast_index_id = ${row.id},
              itunes_id = COALESCE(${itunesId}::INTEGER, itunes_id),
              feed_url = ${row.url},
              title = ${row.title},
              author_id = ${authorId},
              description = COALESCE(${row.description || null}::TEXT, description),
              cover = CASE WHEN ${row.imageUrl || ''} != '' AND ${row.imageUrl || ''} != 'https://podcst.app/placeholder.png' THEN ${row.imageUrl} ELSE cover END,
              website_url = COALESCE(${row.link || null}::TEXT, website_url),
              explicit = ${row.explicit === 1},
              episode_count = GREATEST(${row.episodeCount || 0}, episode_count),
              last_published = GREATEST(${lastPublished}::TIMESTAMPTZ, last_published),
              is_active = ${row.dead !== 1},
              language = COALESCE(${row.language || null}::VARCHAR(10), language),
              popularity_score = ${row.popularityScore}::INTEGER,
              priority = ${row.priority}::INTEGER,
              update_frequency = ${row.updateFrequency ? row.updateFrequency * 86400 : null}::INTEGER,
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
              ${row.id}, ${itunesId}::INTEGER, ${row.url}, ${row.title}, ${authorId},
              ${row.description || null}::TEXT, ${row.imageUrl || 'https://podcst.app/placeholder.png'},
              ${row.link || null}::TEXT, ${row.explicit === 1}, ${row.episodeCount || 0},
              ${lastPublished}::TIMESTAMPTZ, ${row.dead !== 1}, ${row.language || null}::VARCHAR(10),
              ${row.popularityScore}::INTEGER, ${row.priority}::INTEGER, ${row.updateFrequency ? row.updateFrequency * 86400 : null}::INTEGER, now()
            )
          `;
          inserted++;
        }
      } else {
        const [result] = await sql`
          INSERT INTO podcasts (
            podcast_index_id, itunes_id, feed_url, title, author_id, description,
            cover, website_url, explicit, episode_count, last_published,
            is_active, language, popularity_score, priority, update_frequency, updated_at
          ) VALUES (
            ${row.id}, ${itunesId}::INTEGER, ${row.url}, ${row.title}, ${authorId},
            ${row.description || null}::TEXT, ${row.imageUrl || 'https://podcst.app/placeholder.png'},
            ${row.link || null}::TEXT, ${row.explicit === 1}, ${row.episodeCount || 0},
            ${lastPublished}::TIMESTAMPTZ, ${row.dead !== 1}, ${row.language || null}::VARCHAR(10),
            ${row.popularityScore}::INTEGER, ${row.priority}::INTEGER, ${row.updateFrequency ? row.updateFrequency * 86400 : null}::INTEGER, now()
          )
          ON CONFLICT (podcast_index_id) DO UPDATE SET
            itunes_id = COALESCE(EXCLUDED.itunes_id, podcasts.itunes_id),
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
          RETURNING (xmax = 0) AS is_insert
        `;
        if (result?.is_insert) {
          inserted++;
        } else {
          updated++;
        }
      }
    } catch (err) {
      logAction({
        timestamp: new Date().toISOString(),
        action: 'skipped',
        itunes_id: itunesId,
        name: row.title,
        podcast_index_id: row.id,
        feed_url: row.url,
        error: err instanceof Error ? err.message : String(err),
      });
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

  initLogFile();

  console.log('Opening SQLite database...');
  const sqlite = new Database(dbPath, { readonly: true });

  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
  });

  const lastSync = await getLastSyncTime(sql);
  const isFirstSync = !lastSync;
  console.log(isFirstSync ? 'First sync (slow path)' : `Incremental sync since ${lastSync.toISOString()}`);

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
  const startTime = Date.now();

  while (processed < totalCount) {
    const batch = selectQuery.all({ $lastSync: lastSyncUnix, $limit: BATCH_SIZE, $offset: offset });
    if (batch.length === 0) break;

    const { inserted, updated, skipped } = await syncBatch(sql, batch, authorCache, isFirstSync);
    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;
    processed += batch.length;
    offset += BATCH_SIZE;

    const percent = ((processed / totalCount) * 100).toFixed(1);
    const elapsed = Date.now() - startTime;
    const rate = processed / elapsed; // items per ms
    const remaining = (totalCount - processed) / rate;
    const eta = formatDuration(remaining);
    console.log(`Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%) - ETA: ${eta}`);
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

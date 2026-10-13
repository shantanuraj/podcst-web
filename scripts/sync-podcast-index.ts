#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import postgres from 'postgres';
import {
  type CatalogRow,
  catalogInput,
  storeCatalogPodcast,
} from '../src/server/ingest/catalog';
import { resolvePodcast } from '../src/server/ingest/resolve-podcast';
import { migrateStoredId } from '../src/shared/canonical-id';
import {
  checkpointPodcastIndexCursor,
  type PodcastIndexCursor,
  readPodcastIndexCursor,
  writePodcastIndexCursor,
} from './lib/podcast-index-state';

interface LogEntry {
  timestamp: string;
  action: 'inserted' | 'updated' | 'skipped';
  itunes_id: string | null;
  name: string;
  podcast_index_id: number;
  feed_url: string;
  error?: string;
}

let logFilePath: string;

const PODCAST_INDEX_URL =
  'https://public.podcastindex.org/podcastindex_feeds.db.tgz';
const TEMP_DIR =
  process.env.PODCAST_INDEX_WORK_DIR || join(process.cwd(), '.tmp');
const DEFAULT_TGZ_PATH = join(TEMP_DIR, 'podcastindex_feeds.db.tgz');

const BATCH_SIZE = 1000;
const ROW_CONCURRENCY = 20;

const normalizeItunesId = (
  id: number | string | null | undefined,
): string | null => {
  const identity = migrateStoredId(id);
  return 'canonicalId' in identity ? identity.canonicalId : null;
};

const localPath = process.argv[2];

interface PodcastIndexRow extends CatalogRow {
  itunesId: number | string | null;
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

    const bytes = await Bun.write(tgzPath, response);
    console.log(`Downloaded ${(bytes / 1024 / 1024).toFixed(1)} MB`);
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

async function loadAuthors(
  sql: postgres.Sql,
  batch: PodcastIndexRow[],
  authorCache: Map<string, number>,
): Promise<void> {
  const names = [
    ...new Set(batch.map((row) => row.itunesAuthor || 'Unknown')),
  ].filter((name) => !authorCache.has(name));
  if (names.length === 0) return;

  const existing = await sql`
    SELECT id, name FROM authors WHERE name = ANY(${names}::text[])
  `;
  for (const row of existing) authorCache.set(row.name, row.id);

  for (const name of names) {
    if (!authorCache.has(name))
      authorCache.set(name, await ensureAuthor(sql, name));
  }
}

async function syncBatch(
  sql: postgres.Sql,
  batch: PodcastIndexRow[],
  authorCache: Map<string, number>,
): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const privateRows = await sql`
    SELECT id, feed_url FROM podcasts
    WHERE owner_user_id IS NOT NULL AND feed_url = ANY(${batch.map((row) => row.url)}::text[])
  `;
  const privateIds = new Map(
    privateRows.map((row) => [row.feed_url, String(row.id)]),
  );
  await loadAuthors(sql, batch, authorCache);

  const results: Array<'inserted' | 'updated' | 'skipped' | 'failed'> = [];
  for (let offset = 0; offset < batch.length; offset += ROW_CONCURRENCY) {
    const rows = batch.slice(offset, offset + ROW_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        rows.map(async (row) => {
          const itunesId = normalizeItunesId(row.itunesId);
          try {
            const privateId = privateIds.get(row.url);
            if (
              privateId !== undefined &&
              (!itunesId || (await resolvePodcast(sql, itunesId)) !== privateId)
            ) {
              return 'skipped' as const;
            }
            const authorId = authorCache.get(row.itunesAuthor || 'Unknown');
            if (authorId === undefined) throw new Error('Author is missing');
            const result = await storeCatalogPodcast(
              sql,
              catalogInput(row, authorId, itunesId),
            );
            return result;
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
            return 'failed' as const;
          }
        }),
      )),
    );
  }

  return {
    inserted: results.filter((result) => result === 'inserted').length,
    updated: results.filter((result) => result === 'updated').length,
    skipped: results.filter((result) => result === 'skipped').length,
    failed: results.filter((result) => result === 'failed').length,
  };
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
    ...(process.env.PGHOST && { host: process.env.PGHOST }),
  });

  const cursor = await readPodcastIndexCursor(sql);
  console.log(
    cursor.lastUpdate === 0
      ? 'First sync (slow path)'
      : `Incremental sync after ${new Date(cursor.lastUpdate * 1000).toISOString()} / ${cursor.lastId}`,
  );

  const cursorParams = {
    $lastUpdate: cursor.lastUpdate,
    $lastId: cursor.lastId,
  };
  const countQuery = sqlite.query<
    { count: number },
    { $lastUpdate: number; $lastId: number }
  >(`
    SELECT COUNT(*) as count FROM podcasts
    WHERE lastUpdate > $lastUpdate
      OR (lastUpdate = $lastUpdate AND id > $lastId)
  `);
  const countRow = countQuery.get(cursorParams);
  if (!countRow) throw new Error('Podcast Index count query returned no row');
  const { count: totalCount } = countRow;
  console.log(`Found ${totalCount.toLocaleString()} podcasts to sync`);

  if (totalCount === 0) {
    await writePodcastIndexCursor(sql, cursor);
    console.log('Nothing to sync');
    sqlite.close();
    await sql.end();
    if (!localPath) cleanup();
    return;
  }

  const selectQuery = sqlite.query<
    PodcastIndexRow,
    {
      $lastUpdate: number;
      $lastId: number;
      $limit: number;
      $offset: number;
    }
  >(`
    SELECT
      id, url, title, lastUpdate, link, dead, itunesId, itunesAuthor,
      explicit, imageUrl, newestItemPubdate, language, episodeCount,
      popularityScore, priority, updateFrequency, description
    FROM podcasts
    WHERE lastUpdate > $lastUpdate
      OR (lastUpdate = $lastUpdate AND id > $lastId)
    ORDER BY lastUpdate ASC, id ASC
    LIMIT $limit OFFSET $offset
  `);

  const authorCache = new Map<string, number>();
  let processed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let offset = 0;
  let highWater: PodcastIndexCursor = cursor;
  const startTime = Date.now();

  while (processed < totalCount) {
    const batch = selectQuery.all({
      ...cursorParams,
      $limit: BATCH_SIZE,
      $offset: offset,
    });
    if (batch.length === 0) break;

    const { inserted, updated, skipped, failed } = await syncBatch(
      sql,
      batch,
      authorCache,
    );
    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;
    totalFailed += failed;
    processed += batch.length;
    offset += BATCH_SIZE;
    const lastRow = batch.at(-1);
    if (!lastRow || lastRow.lastUpdate === null) {
      throw new Error('Podcast Index source cursor is invalid');
    }
    const batchHighWater = {
      lastUpdate: lastRow.lastUpdate,
      lastId: lastRow.id,
    };
    // Keep failed rows in the next run instead of checkpointing past them.
    if (totalFailed === 0) {
      highWater = batchHighWater;
      await checkpointPodcastIndexCursor(sql, highWater);
    }

    const percent = ((processed / totalCount) * 100).toFixed(1);
    const elapsed = Date.now() - startTime;
    const rate = processed / elapsed; // items per ms
    const remaining = (totalCount - processed) / rate;
    const eta = formatDuration(remaining);
    console.log(
      `Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%) - ETA: ${eta}`,
    );
  }

  if (processed !== totalCount)
    throw new Error(
      `Podcast Index source changed during sync: processed ${processed} of ${totalCount}`,
    );
  if (totalFailed > 0)
    throw new Error(`Podcast Index sync left ${totalFailed} failed rows`);

  await writePodcastIndexCursor(sql, highWater);
  console.log(`\nSync complete:`);
  console.log(`  Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Updated: ${totalUpdated.toLocaleString()}`);
  console.log(`  Skipped: ${totalSkipped.toLocaleString()}`);
  console.log(`  Watermark: ${highWater.lastUpdate}/${highWater.lastId}`);

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

if (import.meta.main) {
  sync().catch((err) => {
    console.error('Sync failed:', err);
    cleanup();
    process.exit(1);
  });
}

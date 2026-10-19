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
import {
  PodcastAccessDenied,
  PodcastIdentityConflict,
} from '../src/server/ingest/podcast-identity';
import { resolvePodcast } from '../src/server/ingest/resolve-podcast';
import { migrateStoredId } from '../src/shared/canonical-id';
import { extractPodcastIndexArchive } from './lib/podcast-index-source';
import {
  checkpointPodcastIndexCursor,
  checkpointUndatedPodcastIndexCursor,
  type PodcastIndexCursor,
  readPodcastIndexCursor,
  readUndatedPodcastIndexCursor,
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

export const isRowRejection = (error: unknown) =>
  error instanceof PodcastIdentityConflict ||
  error instanceof PodcastAccessDenied ||
  error instanceof TypeError;

export function indexSourceOrder(sqlite: Database) {
  sqlite.run(
    'CREATE INDEX IF NOT EXISTS podcasts_sync_order ON podcasts (lastUpdate, id)',
  );
  sqlite.run(`CREATE INDEX IF NOT EXISTS podcasts_sync_undated ON podcasts (id)
    WHERE lastUpdate IS NULL OR lastUpdate <= 0`);
}

// Undated entries have no usable change watermark. Revisit them each completed
// run, with an independent ID checkpoint so failures do not restart this pass.
export function undatedSourceBatches(sqlite: Database, limit: number) {
  const query = sqlite.query<
    PodcastIndexRow,
    { $lastId: number; $limit: number }
  >(`
    SELECT
      id, url, title, lastUpdate, link, dead, itunesId, itunesAuthor,
      explicit, imageUrl, newestItemPubdate, language, episodeCount,
      popularityScore, priority, updateFrequency, description
    FROM podcasts
    WHERE (lastUpdate IS NULL OR lastUpdate <= 0) AND id > $lastId
    ORDER BY id ASC LIMIT $limit
  `);
  return (lastId: number) => query.all({ $lastId: lastId, $limit: limit });
}

export async function syncUndatedSource(
  sqlite: Database,
  limit: number,
  after: number,
  processBatch: (batch: PodcastIndexRow[]) => Promise<unknown>,
  checkpoint: (lastId: number) => Promise<void>,
) {
  const next = undatedSourceBatches(sqlite, limit);
  let processed = 0;
  for (let batch = next(after); batch.length; batch = next(after)) {
    await processBatch(batch);
    after = batch[batch.length - 1].id;
    await checkpoint(after);
    processed += batch.length;
  }
  return processed;
}

// Durable timestamps are nonnegative, so the tuple already excludes negatives
// and NULLs. Exclude zero with != rather than >: a second range constraint can
// make SQLite seek from zero and rescan earlier dated rows on every page.
const DATED_SOURCE_PREDICATE =
  'lastUpdate != 0 AND (lastUpdate, id) > ($lastUpdate, $lastId)';

export function countDatedSource(sqlite: Database, after: PodcastIndexCursor) {
  const row = sqlite
    .query<{ count: number }, { $lastUpdate: number; $lastId: number }>(`
    SELECT COUNT(*) as count FROM podcasts
    WHERE ${DATED_SOURCE_PREDICATE}
  `)
    .get({ $lastUpdate: after.lastUpdate, $lastId: after.lastId });
  if (!row) throw new Error('Podcast Index count query returned no row');
  return row.count;
}

export function sourceBatches(sqlite: Database, limit: number) {
  const query = sqlite.query<
    PodcastIndexRow,
    { $lastUpdate: number; $lastId: number; $limit: number }
  >(`
    SELECT
      id, url, title, lastUpdate, link, dead, itunesId, itunesAuthor,
      explicit, imageUrl, newestItemPubdate, language, episodeCount,
      popularityScore, priority, updateFrequency, description
    FROM podcasts
    WHERE ${DATED_SOURCE_PREDICATE}
    ORDER BY lastUpdate ASC, id ASC
    LIMIT $limit
  `);
  return (after: PodcastIndexCursor) =>
    query.all({
      $lastUpdate: after.lastUpdate,
      $lastId: after.lastId,
      $limit: limit,
    });
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
  return extractPodcastIndexArchive(tgzPath, dbPath);
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
  rejected: number;
}> {
  const privateRows = await sql`
    SELECT id, feed_url FROM podcasts
    WHERE owner_user_id IS NOT NULL AND feed_url = ANY(${batch.map((row) => row.url)}::text[])
  `;
  const privateIds = new Map(
    privateRows.map((row) => [row.feed_url, String(row.id)]),
  );
  await loadAuthors(sql, batch, authorCache);

  const results: Array<'inserted' | 'updated' | 'skipped' | 'rejected'> = [];
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
            if (!isRowRejection(err)) throw err;
            logAction({
              timestamp: new Date().toISOString(),
              action: 'skipped',
              itunes_id: itunesId,
              name: row.title,
              podcast_index_id: row.id,
              feed_url: row.url,
              error: err instanceof Error ? err.message : String(err),
            });
            return 'rejected' as const;
          }
        }),
      )),
    );
  }

  return {
    inserted: results.filter((result) => result === 'inserted').length,
    updated: results.filter((result) => result === 'updated').length,
    skipped: results.filter((result) => result === 'skipped').length,
    rejected: results.filter((result) => result === 'rejected').length,
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
  const sqlite = new Database(dbPath);
  console.log('Indexing source order...');
  indexSourceOrder(sqlite);

  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    ...(process.env.PGHOST && { host: process.env.PGHOST }),
  });

  const cursor = await readPodcastIndexCursor(sql);
  const authorCache = new Map<string, number>();
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalRejected = 0;
  const processBatch = async (batch: PodcastIndexRow[]) => {
    const { inserted, updated, skipped, rejected } = await syncBatch(
      sql,
      batch,
      authorCache,
    );
    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;
    totalRejected += rejected;
  };
  const undatedAfter = await readUndatedPodcastIndexCursor(sql);
  const undatedCount = await syncUndatedSource(
    sqlite,
    BATCH_SIZE,
    undatedAfter,
    processBatch,
    (lastId) => checkpointUndatedPodcastIndexCursor(sql, lastId),
  );
  console.log(`Processed ${undatedCount.toLocaleString()} undated podcasts`);
  console.log(
    cursor.lastUpdate === 0
      ? 'First sync (slow path)'
      : `Incremental sync after ${new Date(cursor.lastUpdate * 1000).toISOString()} / ${cursor.lastId}`,
  );

  const totalCount = countDatedSource(sqlite, cursor);
  console.log(`Found ${totalCount.toLocaleString()} dated podcasts to sync`);

  const nextBatch = sourceBatches(sqlite, BATCH_SIZE);

  let processed = 0;
  let highWater: PodcastIndexCursor = cursor;
  const startTime = Date.now();

  while (processed < totalCount) {
    const batch = nextBatch(highWater);
    if (batch.length === 0) break;

    await processBatch(batch);
    processed += batch.length;
    const lastRow = batch.at(-1);
    if (!lastRow || lastRow.lastUpdate === null) {
      throw new Error('Podcast Index source cursor is invalid');
    }
    highWater = { lastUpdate: lastRow.lastUpdate, lastId: lastRow.id };
    await checkpointPodcastIndexCursor(sql, highWater);

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

  await writePodcastIndexCursor(sql, highWater);
  console.log(`\nSync complete:`);
  console.log(`  Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Updated: ${totalUpdated.toLocaleString()}`);
  console.log(`  Skipped: ${totalSkipped.toLocaleString()}`);
  console.log(
    `  Rejected: ${totalRejected.toLocaleString()} (see ${logFilePath})`,
  );
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
    // Keep the source snapshot so retries resume against the same ID ordering.
    process.exit(1);
  });
}

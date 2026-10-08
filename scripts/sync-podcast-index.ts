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
const TEMP_DIR = join(process.cwd(), '.tmp');
const DEFAULT_TGZ_PATH = join(TEMP_DIR, 'podcastindex_feeds.db.tgz');

const BATCH_SIZE = 1000;

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

    const buffer = await response.arrayBuffer();
    await Bun.write(tgzPath, buffer);
    console.log(
      `Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`,
    );
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
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const privateRows = await sql`
    SELECT id, feed_url FROM podcasts
    WHERE owner_user_id IS NOT NULL AND feed_url = ANY(${batch.map((row) => row.url)}::text[])
  `;
  const privateIds = new Map(
    privateRows.map((row) => [row.feed_url, String(row.id)]),
  );

  for (const row of batch) {
    const itunesId = normalizeItunesId(row.itunesId);
    try {
      const privateId = privateIds.get(row.url);
      if (
        privateId !== undefined &&
        (!itunesId || (await resolvePodcast(sql, itunesId)) !== privateId)
      ) {
        skipped++;
        continue;
      }
      const authorName = row.itunesAuthor || 'Unknown';
      let authorId = authorCache.get(authorName);
      if (!authorId) {
        authorId = await ensureAuthor(sql, authorName);
        authorCache.set(authorName, authorId);
      }
      const result = await storeCatalogPodcast(
        sql,
        catalogInput(row, authorId, itunesId),
      );
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
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
  console.log(
    isFirstSync
      ? 'First sync (slow path)'
      : `Incremental sync since ${lastSync.toISOString()}`,
  );

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

  const selectQuery = sqlite.query<
    PodcastIndexRow,
    { $lastSync: number; $limit: number; $offset: number }
  >(`
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
    const batch = selectQuery.all({
      $lastSync: lastSyncUnix,
      $limit: BATCH_SIZE,
      $offset: offset,
    });
    if (batch.length === 0) break;

    const { inserted, updated, skipped } = await syncBatch(
      sql,
      batch,
      authorCache,
    );
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
    console.log(
      `Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%) - ETA: ${eta}`,
    );
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

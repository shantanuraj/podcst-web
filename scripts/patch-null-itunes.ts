#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import postgres from 'postgres';

const PODCAST_INDEX_URL =
  'https://public.podcastindex.org/podcastindex_feeds.db.tgz';
const TEMP_DIR = join(process.cwd(), '.tmp');
const DEFAULT_TGZ_PATH = join(TEMP_DIR, 'podcastindex_feeds.db.tgz');

const BATCH_SIZE = 4000;

const localPath = process.argv[2];

interface PodcastIndexRow {
  id: number;
  url: string;
  title: string;
  lastUpdate: number | null;
  link: string;
  dead: number;
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

async function loadAuthorCache(
  sql: postgres.Sql,
): Promise<Map<string, number>> {
  console.log('Loading author cache...');
  const rows = await sql`SELECT id, name FROM authors`;
  const cache = new Map<string, number>();
  for (const row of rows) {
    cache.set(row.name, row.id);
  }
  console.log(`Loaded ${cache.size.toLocaleString()} authors`);
  return cache;
}

async function ensureAuthors(
  sql: postgres.Sql,
  names: string[],
  cache: Map<string, number>,
): Promise<void> {
  const newNames = names.filter((n) => !cache.has(n));
  if (newNames.length === 0) return;

  const unique = [...new Set(newNames)];
  const inserted = await sql`
    INSERT INTO authors (name)
    SELECT * FROM unnest(${unique}::text[])
    ON CONFLICT (name) DO NOTHING
    RETURNING id, name
  `;

  for (const row of inserted) {
    cache.set(row.name, row.id);
  }

  const stillMissing = unique.filter((n) => !cache.has(n));
  if (stillMissing.length > 0) {
    const existing = await sql`
      SELECT id, name FROM authors WHERE name = ANY(${stillMissing}::text[])
    `;
    for (const row of existing) {
      cache.set(row.name, row.id);
    }
  }
}

async function syncBatch(
  sql: postgres.Sql,
  batch: PodcastIndexRow[],
  authorCache: Map<string, number>,
): Promise<{ inserted: number; skipped: number }> {
  const authorNames = batch.map((r) => r.itunesAuthor || 'Unknown');
  await ensureAuthors(sql, authorNames, authorCache);

  const values = batch.map((row) => {
    const authorName = row.itunesAuthor || 'Unknown';
    const authorId = authorCache.get(authorName)!;
    const lastPublished = row.newestItemPubdate
      ? new Date(row.newestItemPubdate * 1000)
      : null;

    return {
      podcast_index_id: row.id,
      feed_url: row.url,
      title: row.title,
      author_id: authorId,
      description: row.description || null,
      cover: row.imageUrl || 'https://podcst.app/placeholder.png',
      website_url: row.link || null,
      explicit: row.explicit === 1,
      episode_count: row.episodeCount || 0,
      last_published: lastPublished,
      is_active: row.dead !== 1,
      language: row.language || null,
      popularity_score: row.popularityScore,
      priority: row.priority,
      update_frequency: row.updateFrequency
        ? row.updateFrequency * 86400
        : null,
    };
  });

  const result = await sql`
    INSERT INTO podcasts ${sql(
      values,
      'podcast_index_id',
      'feed_url',
      'title',
      'author_id',
      'description',
      'cover',
      'website_url',
      'explicit',
      'episode_count',
      'last_published',
      'is_active',
      'language',
      'popularity_score',
      'priority',
      'update_frequency',
    )}
    ON CONFLICT (feed_url) DO NOTHING
  `;

  const inserted = result.count;
  const skipped = batch.length - inserted;

  return { inserted, skipped };
}

async function patch(): Promise<void> {
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

  const authorCache = await loadAuthorCache(sql);

  const countQuery = sqlite.query<{ count: number }, []>(`
    SELECT COUNT(*) as count FROM podcasts
    WHERE itunesId IS NULL
  `);
  const { count: totalCount } = countQuery.get()!;
  console.log(
    `Found ${totalCount.toLocaleString()} podcasts with null itunesId`,
  );

  if (totalCount === 0) {
    console.log('Nothing to patch');
    sqlite.close();
    await sql.end();
    return;
  }

  const selectQuery = sqlite.query<
    PodcastIndexRow,
    { $limit: number; $offset: number }
  >(`
    SELECT
      id, url, title, lastUpdate, link, dead, itunesAuthor,
      explicit, imageUrl, newestItemPubdate, language, episodeCount,
      popularityScore, priority, updateFrequency, description
    FROM podcasts
    WHERE itunesId IS NULL
    ORDER BY popularityScore DESC NULLS LAST
    LIMIT $limit OFFSET $offset
  `);

  let processed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let offset = 0;
  const startTime = Date.now();

  while (processed < totalCount) {
    const batch = selectQuery.all({
      $limit: BATCH_SIZE,
      $offset: offset,
    });
    if (batch.length === 0) break;

    const { inserted, skipped } = await syncBatch(sql, batch, authorCache);
    totalInserted += inserted;
    totalSkipped += skipped;
    processed += batch.length;
    offset += BATCH_SIZE;

    const percent = ((processed / totalCount) * 100).toFixed(1);
    const elapsed = Date.now() - startTime;
    const rate = processed / elapsed;
    const remaining = (totalCount - processed) / rate;
    const eta = formatDuration(remaining);
    const ratePerSec = (rate * 1000).toFixed(0);
    console.log(
      `Progress: ${processed.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%) [${ratePerSec}/s] - ETA: ${eta}`,
    );
  }

  console.log(`\nPatch complete:`);
  console.log(`  Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Skipped: ${totalSkipped.toLocaleString()}`);

  sqlite.close();
  await sql.end();
}

patch().catch((err) => {
  console.error('Patch failed:', err);
  process.exit(1);
});

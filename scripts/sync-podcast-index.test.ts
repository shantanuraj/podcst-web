import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import postgres from 'postgres';
import {
  PodcastAccessDenied,
  PodcastIdentityBusy,
  PodcastIdentityConflict,
} from '../src/server/ingest/podcast-identity';
import { INITIAL_PODCAST_INDEX_CURSOR } from './lib/podcast-index-state';
import {
  indexSourceOrder,
  isRowRejection,
  sourceBatches,
} from './sync-podcast-index';

function source(rows: [number, number | null][]) {
  const sqlite = new Database(':memory:');
  sqlite.run(`
    CREATE TABLE podcasts (
      id INTEGER PRIMARY KEY, url TEXT, title TEXT, lastUpdate INTEGER, link TEXT,
      dead INTEGER, itunesId INTEGER, itunesAuthor TEXT, explicit INTEGER,
      imageUrl TEXT, newestItemPubdate INTEGER, language TEXT, episodeCount INTEGER,
      popularityScore INTEGER, priority INTEGER, updateFrequency INTEGER, description TEXT
    )
  `);
  const insert = sqlite.prepare(
    'INSERT INTO podcasts (id, lastUpdate, url, title) VALUES (?, ?, ?, ?)',
  );
  for (const [id, lastUpdate] of rows)
    insert.run(
      id,
      lastUpdate,
      `https://example.invalid/${id}`,
      `Podcast ${id}`,
    );
  return sqlite;
}

test('source batches page by update time and id from a cursor', () => {
  const sqlite = source([
    [5, 20],
    [1, 10],
    [3, 10],
    [2, 30],
    [4, null],
    [6, 20],
  ]);
  indexSourceOrder(sqlite);
  const next = sourceBatches(sqlite, 2);
  const seen: [number, number | null][] = [];
  let cursor = INITIAL_PODCAST_INDEX_CURSOR;
  for (let batch = next(cursor); batch.length; batch = next(cursor)) {
    seen.push(
      ...batch.map(
        (row) => [row.id, row.lastUpdate] as [number, number | null],
      ),
    );
    const last = batch.at(-1);
    cursor = { lastUpdate: last?.lastUpdate ?? 0, lastId: last?.id ?? 0 };
  }
  expect(seen).toEqual([
    [1, 10],
    [3, 10],
    [5, 20],
    [6, 20],
    [2, 30],
  ]);
  expect(next({ lastUpdate: 20, lastId: 5 }).map((row) => row.id)).toEqual([
    6, 2,
  ]);
});

test('paging uses the source order index instead of sorting the table', () => {
  const sqlite = source([[1, 10]]);
  indexSourceOrder(sqlite);
  indexSourceOrder(sqlite);
  const plan = sqlite
    .query(
      `EXPLAIN QUERY PLAN SELECT id FROM podcasts
       WHERE (lastUpdate, id) > (1, 1) ORDER BY lastUpdate ASC, id ASC LIMIT 2`,
    )
    .all() as { detail: string }[];
  const details = plan.map(({ detail }) => detail).join(' ');
  expect(details).toContain('podcasts_sync_order');
  expect(details).not.toContain('TEMP B-TREE');
});

test('identity conflicts and invalid rows are rejections; other errors abort', () => {
  expect(isRowRejection(new PodcastIdentityConflict('conflict'))).toBe(true);
  expect(isRowRejection(new PodcastAccessDenied('private'))).toBe(true);
  expect(isRowRejection(new TypeError('Invalid URL'))).toBe(true);
  expect(isRowRejection(new PodcastIdentityBusy('busy'))).toBe(false);
  expect(isRowRejection(new Error('connection lost'))).toBe(false);
  expect(isRowRejection(Object.create(postgres.PostgresError.prototype))).toBe(
    false,
  );
});

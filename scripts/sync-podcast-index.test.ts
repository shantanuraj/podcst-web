import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import postgres from 'postgres';
import {
  PodcastAccessDenied,
  PodcastIdentityBusy,
  PodcastIdentityConflict,
} from '../src/server/ingest/podcast-identity';
import { INITIAL_PODCAST_INDEX_CURSOR } from './lib/podcast-index-state';
import {
  countDatedSource,
  indexSourceOrder,
  isRowRejection,
  sourceBatches,
  syncUndatedSource,
  undatedSourceBatches,
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

test('dated source batches page by update time and id; NULLs belong to the undated pass', () => {
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
  expect(undatedSourceBatches(sqlite, 2)(0).map((row) => row.id)).toEqual([4]);
  sqlite.close();
});

test('paging uses the source order index instead of sorting the table', () => {
  const sqlite = source([[1, 10]]);
  indexSourceOrder(sqlite);
  indexSourceOrder(sqlite);
  const plan = sqlite
    .query(
      `EXPLAIN QUERY PLAN SELECT id FROM podcasts
       WHERE lastUpdate != 0 AND (lastUpdate, id) > (1, 1) ORDER BY lastUpdate ASC, id ASC LIMIT 2`,
    )
    .all() as { detail: string }[];
  const details = plan.map(({ detail }) => detail).join(' ');
  expect(details).toContain('podcasts_sync_order');
  expect(details).not.toContain('TEMP B-TREE');
});

test('dated queries seek from a late cursor rather than scanning from zero', () => {
  const sqlite = source([
    [1, 10],
    [2, 20],
    [3, 30],
  ]);
  indexSourceOrder(sqlite);
  const prepare = spyOn(sqlite, 'query');
  let statements: string[];
  try {
    const after = { lastUpdate: 20, lastId: 2 };
    expect(countDatedSource(sqlite, after)).toBe(1);
    expect(sourceBatches(sqlite, 1)(after).map((row) => row.id)).toEqual([3]);
    statements = prepare.mock.calls.map(([query]) => query);
  } finally {
    prepare.mockRestore();
  }
  try {
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      const plan = sqlite
        .query<
          { opcode: string; p1: number; p2: number; p3: number },
          Record<string, number>
        >(`EXPLAIN ${statement}`)
        .all({
          $lastUpdate: 20,
          $lastId: 2,
          ...(statement.includes('$limit') ? { $limit: 1 } : {}),
        });
      const seekIndex = plan.findIndex(({ opcode }) =>
        opcode.startsWith('Seek'),
      );
      expect(seekIndex).toBeGreaterThan(-1);
      const seek = plan[seekIndex];
      // EXPLAIN QUERY PLAN reports the same index for both a cursor seek and a
      // scan from zero. Inspect the actual seek register to distinguish them.
      const bound = plan
        .slice(0, seekIndex)
        .filter(
          ({ opcode, p2 }) =>
            p2 === seek.p3 && (opcode === 'Variable' || opcode === 'Integer'),
        )
        .at(-1);
      expect(bound?.opcode).toBe('Variable');
      expect(bound?.p1).toBe(1); // $lastUpdate is the first bound parameter.
    }
  } finally {
    sqlite.close();
  }
});

test('dated count and batches agree, including zero only in the undated pass', () => {
  const sqlite = source([
    [1, null],
    [2, 0],
    [3, -1],
    [4, 10],
    [5, 10],
    [6, 20],
  ]);
  indexSourceOrder(sqlite);
  for (const cursor of [
    INITIAL_PODCAST_INDEX_CURSOR,
    { lastUpdate: 10, lastId: 4 },
    { lastUpdate: 20, lastId: 6 },
  ]) {
    expect(countDatedSource(sqlite, cursor)).toBe(
      sourceBatches(sqlite, 100)(cursor).length,
    );
  }
  expect(undatedSourceBatches(sqlite, 100)(0).map((row) => row.id)).toEqual([
    1, 2, 3,
  ]);
  expect(
    sourceBatches(
      sqlite,
      100,
    )(INITIAL_PODCAST_INDEX_CURSOR).map((row) => row.id),
  ).toEqual([4, 5, 6]);
  sqlite.close();
});

test('undated pass resumes after committed batches and replays a failed batch', async () => {
  const sqlite = source([
    [1, null],
    [2, 0],
    [3, null],
    [4, 0],
    [5, 10],
  ]);
  indexSourceOrder(sqlite);
  let checkpoint = 0;
  const committed: number[] = [];
  await expect(
    syncUndatedSource(
      sqlite,
      2,
      checkpoint,
      async (batch) => {
        if (batch[0].id === 3) throw new Error('connection lost');
        committed.push(...batch.map((row) => row.id));
      },
      async (id) => {
        checkpoint = id;
      },
    ),
  ).rejects.toThrow('connection lost');
  expect(checkpoint).toBe(2);
  expect(committed).toEqual([1, 2]);
  expect(
    await syncUndatedSource(
      sqlite,
      2,
      checkpoint,
      async (batch) => {
        committed.push(...batch.map((row) => row.id));
      },
      async (id) => {
        checkpoint = id;
      },
    ),
  ).toBe(2);
  expect(checkpoint).toBe(4);
  expect(committed).toEqual([1, 2, 3, 4]);
  // Completion resets this cursor, so newly undated lower IDs are revisited.
  sqlite.run('UPDATE podcasts SET lastUpdate = NULL WHERE id = 5');
  expect(
    await syncUndatedSource(
      sqlite,
      2,
      0,
      async () => {},
      async () => {},
    ),
  ).toBe(5);
  sqlite.close();
});

test('undated entries are repaired even when dated watermark is already complete', async () => {
  const sqlite = source([
    [1, null],
    [2, 0],
    [3, 10],
  ]);
  indexSourceOrder(sqlite);
  expect(countDatedSource(sqlite, { lastUpdate: 100, lastId: 99 })).toBe(0);
  const seen: number[] = [];
  expect(
    await syncUndatedSource(
      sqlite,
      1,
      0,
      async (batch) => {
        seen.push(...batch.map((row) => row.id));
      },
      async () => {},
    ),
  ).toBe(2);
  expect(seen).toEqual([1, 2]);
  sqlite.close();
});

test('a failed undated checkpoint replays successful but uncheckpointed writes', async () => {
  const sqlite = source([
    [1, null],
    [2, 0],
  ]);
  indexSourceOrder(sqlite);
  const attempts: number[][] = [];
  const processBatch = async (batch: { id: number }[]) => {
    attempts.push(batch.map((row) => row.id));
  };
  await expect(
    syncUndatedSource(sqlite, 2, 0, processBatch, async () => {
      throw new Error('checkpoint unavailable');
    }),
  ).rejects.toThrow('checkpoint unavailable');
  await syncUndatedSource(sqlite, 2, 0, processBatch, async () => {});
  expect(attempts).toEqual([
    [1, 2],
    [1, 2],
  ]);
  sqlite.close();
});

test('undated pagination seeks its partial index without sorting', () => {
  const sqlite = source([
    [1, null],
    [2, 0],
    [3, 10],
  ]);
  indexSourceOrder(sqlite);
  const plan = sqlite
    .query(`EXPLAIN QUERY PLAN SELECT * FROM podcasts
    WHERE (lastUpdate IS NULL OR lastUpdate <= 0) AND id > 1
    ORDER BY id ASC LIMIT 2`)
    .all() as { detail: string }[];
  const details = plan.map((row) => row.detail).join(' ');
  expect(details).toContain(
    'SEARCH podcasts USING INDEX podcasts_sync_undated',
  );
  expect(details).not.toContain('TEMP B-TREE');
  sqlite.close();
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

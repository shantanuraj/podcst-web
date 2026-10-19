import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPodcastIndexCursor,
  readUndatedPodcastIndexCursor,
} from './lib/podcast-index-state';
import { startPostgres } from './lib/postgres-sandbox';
import { migrate } from './migrations';

async function runImporter(
  cluster: ReturnType<typeof startPostgres>,
  source: string,
  work: string,
) {
  const target = new URL(cluster.url);
  target.search = ''; // The importer receives the private socket via PGHOST.
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      new URL('./sync-podcast-index.ts', import.meta.url).pathname,
      source,
    ],
    {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: target.href,
        PGHOST: cluster.directory,
        PODCAST_INDEX_WORK_DIR: work,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    return stdout;
  } finally {
    clearTimeout(timeout);
  }
}

describe.skipIf(!process.env.PG_BIN)(
  'Podcast Index completion summaries',
  () => {
    test.each([
      { name: 'undated-only', undated: true, dated: false },
      { name: 'mixed', undated: true, dated: true },
      { name: 'empty', undated: false, dated: false },
    ])('reports all outcomes for $name sources', async ({ undated, dated }) => {
      const directory = mkdtempSync(join(tmpdir(), 'podcst-index-summary-'));
      const cluster = startPostgres();
      try {
        await migrate(cluster.sql);
        const sourceDirectory = join(directory, 'source');
        mkdirSync(sourceDirectory);
        const source = join(sourceDirectory, 'podcastindex_feeds.db');
        const sqlite = new Database(source);
        try {
          sqlite.run(`CREATE TABLE podcasts (
          id INTEGER PRIMARY KEY, url TEXT, title TEXT, lastUpdate INTEGER, link TEXT,
          dead INTEGER, itunesId INTEGER, itunesAuthor TEXT, explicit INTEGER,
          imageUrl TEXT, newestItemPubdate INTEGER, language TEXT, episodeCount INTEGER,
          popularityScore INTEGER, priority INTEGER, updateFrequency INTEGER, description TEXT
        )`);
          const insert = sqlite.query(
            'INSERT INTO podcasts (id, url, title, lastUpdate) VALUES (?, ?, ?, ?)',
          );
          if (undated) {
            insert.run(1, 'https://example.invalid/undated', 'Undated', 0);
            insert.run(3, 'not a URL', 'Rejected', null);
          }
          if (dated)
            insert.run(2, 'https://example.invalid/dated', 'Dated', 10);
        } finally {
          sqlite.close();
        }
        const work = join(directory, 'work');
        const stdout = await runImporter(cluster, source, work);
        const inserted = Number(undated) + Number(dated);
        expect(stdout).toContain('Sync complete:');
        expect(stdout).not.toContain('Nothing to sync');
        expect(stdout).toContain(`Inserted: ${inserted}\n`);
        expect(stdout).toContain('Updated: 0\n');
        expect(stdout).toContain('Skipped: 0\n');
        expect(stdout).toContain(`Rejected: ${Number(undated)} (see `);
        expect(
          (await cluster.sql`SELECT count(*)::int AS count FROM podcasts`)[0]
            .count,
        ).toBe(inserted);
        expect(await readPodcastIndexCursor(cluster.sql)).toEqual(
          dated ? { lastUpdate: 10, lastId: 2 } : { lastUpdate: 0, lastId: 0 },
        );
        expect(await readUndatedPodcastIndexCursor(cluster.sql)).toBe(0);
        expect(
          (
            await cluster.sql`SELECT completed_at FROM podcast_index_sync_state`
          )[0].completed_at,
        ).toBeInstanceOf(Date);
        expect(existsSync(source)).toBe(true);

        // The next attempt revisits undated rows but not the completed dated row.
        const repeat = await runImporter(cluster, source, work);
        expect(repeat).toContain('Sync complete:');
        expect(repeat).toContain('Inserted: 0\n');
        expect(repeat).toContain(`Updated: ${Number(undated)}\n`);
        expect(repeat).toContain(`Rejected: ${Number(undated)} (see `);
      } finally {
        await cluster.stop();
        rmSync(directory, { recursive: true, force: true });
      }
    }, 30_000);
  },
);

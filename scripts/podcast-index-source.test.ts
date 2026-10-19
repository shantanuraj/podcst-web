import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPodcastIndexArchive } from './lib/podcast-index-source';

test('failed extraction never publishes a partial snapshot and can be retried', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-index-source-'));
  try {
    const source = join(directory, 'source');
    const work = join(directory, 'work');
    mkdirSync(source);
    mkdirSync(work);
    const filename = 'podcastindex_feeds.db';
    const sqlite = new Database(join(source, filename));
    sqlite.run('CREATE TABLE podcasts (id INTEGER PRIMARY KEY, payload BLOB)');
    sqlite
      .query('INSERT INTO podcasts VALUES (1, ?)')
      .run(randomBytes(256 * 1024));
    sqlite.close();
    const archive = join(directory, 'source.tgz');
    const tar = Bun.spawnSync(['tar', '-czf', archive, '-C', source, filename]);
    expect(tar.exitCode).toBe(0);
    const complete = readFileSync(archive);
    writeFileSync(
      archive,
      complete.subarray(0, Math.floor(complete.length / 2)),
    );
    const dbPath = join(work, filename);

    await expect(extractPodcastIndexArchive(archive, dbPath)).rejects.toThrow(
      'Failed to extract archive',
    );
    expect(existsSync(dbPath)).toBe(false);
    expect(readdirSync(work)).toEqual([]);

    writeFileSync(archive, complete);
    expect(await extractPodcastIndexArchive(archive, dbPath)).toBe(dbPath);
    expect(readFileSync(dbPath)).toEqual(readFileSync(join(source, filename)));
    expect(readdirSync(work)).toEqual([filename]);
    expect(existsSync(archive)).toBe(true);
    const published = new Database(dbPath, { readonly: true });
    expect(published.query('PRAGMA quick_check').get()).toEqual({
      quick_check: 'ok',
    });
    published.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an archive without the database does not publish a resumable snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-index-source-'));
  try {
    const source = join(directory, 'source');
    const work = join(directory, 'work');
    mkdirSync(source);
    mkdirSync(work);
    writeFileSync(join(source, 'unrelated.txt'), 'synthetic archive');
    const archive = join(directory, 'source.tgz');
    expect(
      Bun.spawnSync(['tar', '-czf', archive, '-C', source, 'unrelated.txt'])
        .exitCode,
    ).toBe(0);
    await expect(
      extractPodcastIndexArchive(archive, join(work, 'podcastindex_feeds.db')),
    ).rejects.toThrow();
    expect(readdirSync(work)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

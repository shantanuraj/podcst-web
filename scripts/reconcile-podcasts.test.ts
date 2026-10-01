import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  digest,
  type ReconciliationPlan,
  reconcile,
} from './reconcile-podcasts';
import { startPostgres } from './test/postgres';

const pgBin = process.env.PG_BIN;
let directory: string;
let sql: postgres.Sql;
let cluster: ReturnType<typeof startPostgres>;
let serial = 0;
const plan: ReconciliationPlan = {
  canonicalId: 1,
  duplicateId: 2,
  canonicalFeedUrl: 'https://feeds.example.invalid/current',
  reviewedDifferences: digest([]),
};

function path() {
  return join(directory, `artifact-${serial++}.json`);
}

async function inspect(custom = plan) {
  const expectedPath = path();
  const result = await reconcile(sql, {
    plan: custom,
    backupPath: expectedPath,
    mode: 'inspect',
  });
  return {
    expectedPath,
    result,
    artifact: JSON.parse(readFileSync(expectedPath, 'utf8')),
  };
}

async function apply(mode: 'apply' | 'dry-run' = 'apply', custom = plan) {
  const { expectedPath } = await inspect(custom);
  return reconcile(sql, {
    plan: custom,
    expectedPath,
    backupPath: path(),
    mode,
  });
}

const seed = `
INSERT INTO authors(id,name) VALUES (1,'Synthetic publisher');
INSERT INTO users(id,email) VALUES ('listener','listener@example.invalid');
INSERT INTO podcasts(id,feed_url,title,author_id,cover,itunes_id,podcast_index_id,episode_count)
VALUES (1,'https://feeds.example.invalid/old','Fixture',1,'cover',100,200,3),
(2,'https://feeds.example.invalid/current','Fixture',1,'cover',NULL,NULL,3);
INSERT INTO episodes(id,podcast_id,guid,published) VALUES
(10,1,'shared-a','2026-01-01'),(11,1,'shared-b','2026-01-02'),(12,1,'canonical-only','2025-01-01'),
(20,2,'shared-a','2026-01-01'),(21,2,'shared-b','2026-01-02'),(22,2,'duplicate-only','2026-01-03');
INSERT INTO episode_content(episode_id,title,file_url)
SELECT id,guid,'https://media.example.invalid/'||guid||'.mp3' FROM episodes WHERE id<>11;
INSERT INTO subscriptions(user_id,podcast_id,subscribed_at) VALUES ('listener',2,'2026-01-01');
INSERT INTO playback_progress(user_id,episode_id,position,completed,updated_at)
VALUES ('listener',20,123,false,'2026-01-01'),('listener',22,45,true,'2026-01-02');
INSERT INTO feed_poll_state(podcast_id,etag,last_modified,hash,failures)
VALUES (1,'old','old','old',2),(2,'other','other','other',1);
`;

describe.skipIf(!pgBin)('guarded reconciliation on isolated PostgreSQL', () => {
  beforeAll(() => {
    cluster = startPostgres();
    directory = cluster.directory;
    sql = cluster.sql;
  }, 30_000);

  afterAll(async () => {
    await cluster?.stop();
  });

  beforeEach(async () => {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
${readFileSync(new URL('../migrations/active/0000-baseline.sql', import.meta.url), 'utf8')}
${seed}`);
  });

  test('inspection backs up without changing data; dry run checks and rolls back', async () => {
    const { artifact } = await inspect();
    expect(artifact.snapshot.episodes).toHaveLength(6);
    expect(artifact.episodeMap).toHaveLength(2);
    expect(artifact.uniqueEpisodeIds).toEqual([22]);
    expect((await apply('dry-run'))?.postconditionsVerified).toBe(true);
    expect((await sql`SELECT count(*)::int AS n FROM episodes`)[0].n).toBe(6);
  });

  test('preserves the union, fills missing content and transfers exact progress', async () => {
    const before =
      await sql`SELECT episode_id,position,completed,updated_at FROM playback_progress ORDER BY episode_id`;
    const result = await apply();
    expect(result?.retainedEpisodes).toBe(4);
    expect(result?.retainedContent).toBe(4);
    expect(result?.retainedProgress).toBe(2);
    expect(
      Array.from(
        await sql`SELECT id::int,podcast_id::int FROM episodes ORDER BY id`,
      ),
    ).toEqual([
      { id: 10, podcast_id: 1 },
      { id: 11, podcast_id: 1 },
      { id: 12, podcast_id: 1 },
      { id: 22, podcast_id: 1 },
    ]);
    expect(
      Array.from(
        await sql`SELECT episode_id,position,completed,updated_at FROM playback_progress ORDER BY episode_id`,
      ),
    ).toEqual(
      before.map((row) => ({
        ...row,
        episode_id: row.episode_id === '20' ? '10' : row.episode_id,
      })),
    );
    expect(
      (await sql`SELECT podcast_id::int FROM subscriptions`)[0].podcast_id,
    ).toBe(1);
    expect(
      (
        await sql`SELECT itunes_id::int,podcast_index_id::int,feed_url FROM podcasts`
      )[0],
    ).toEqual({
      itunes_id: 100,
      podcast_index_id: 200,
      feed_url: plan.canonicalFeedUrl,
    });
    expect(
      (
        await sql`SELECT etag IS NULL AND last_modified IS NULL AND hash IS NULL AND last_polled_at IS NULL AND failures=0 AS valid FROM feed_poll_state`
      )[0].valid,
    ).toBe(true);
  });

  test('keeps the earliest subscription timestamp', async () => {
    await sql`INSERT INTO subscriptions(user_id,podcast_id,subscribed_at) VALUES ('listener',1,'2026-02-01')`;
    await apply();
    expect(
      (
        await sql`SELECT count(*)::int AS n, min(subscribed_at)='2026-01-01'::timestamptz AS original FROM subscriptions`
      )[0],
    ).toEqual({ n: 1, original: true });
  });

  test('refuses progress collisions rather than guessing position or completion', async () => {
    await sql`INSERT INTO playback_progress(user_id,episode_id,position) VALUES ('listener',10,7)`;
    await expect(inspect()).rejects.toThrow('Playback progress conflict');
    expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(2);
  });

  test('refuses media disagreement', async () => {
    await sql`UPDATE episode_content SET file_url='https://media.example.invalid/different.mp3' WHERE episode_id=20`;
    await expect(inspect()).rejects.toThrow('Shared episode media differs');
  });

  test('requires review of metadata differences and retains canonical values', async () => {
    await sql`UPDATE episodes SET published='2026-02-01' WHERE id=20`;
    await sql`UPDATE episode_content SET title='Revised title' WHERE episode_id=20`;
    const { result, expectedPath } = await inspect();
    await expect(
      reconcile(sql, { plan, expectedPath, backupPath: path(), mode: 'apply' }),
    ).rejects.toThrow('Metadata differences have not been reviewed');
    if (!result) throw new Error('Inspection result missing');
    await apply('apply', {
      ...plan,
      reviewedDifferences: result.differencesDigest,
    });
    expect(
      (await sql`SELECT title FROM episode_content WHERE episode_id=10`)[0]
        .title,
    ).toBe('shared-a');
    expect(
      (
        await sql`SELECT published='2026-01-01'::timestamptz AS original FROM episodes WHERE id=10`
      )[0].original,
    ).toBe(true);
  });

  test('requires separate review when metadata differs but media was evicted', async () => {
    await sql`UPDATE episodes SET published='2026-02-01' WHERE id=21`;
    const { result } = await inspect();
    if (!result) throw new Error('Inspection result missing');
    const reviewed = { ...plan, reviewedDifferences: result.differencesDigest };
    const { expectedPath } = await inspect(reviewed);
    await expect(
      reconcile(sql, {
        plan: reviewed,
        expectedPath,
        backupPath: path(),
        mode: 'apply',
      }),
    ).rejects.toThrow('Missing-media metadata cases require separate');
    await apply('apply', {
      ...reviewed,
      reviewedMissingMedia: result.missingMediaDigest,
    });
    expect(
      (await sql`SELECT title FROM episode_content WHERE episode_id=11`)[0]
        .title,
    ).toBe('shared-b');
  });

  test('refuses a changed snapshot and new foreign-key dependencies', async () => {
    const { expectedPath } = await inspect();
    await sql`UPDATE playback_progress SET position=124 WHERE episode_id=20`;
    await expect(
      reconcile(sql, { plan, expectedPath, backupPath: path(), mode: 'apply' }),
    ).rejects.toThrow('Reviewed snapshot changed');
    await sql`CREATE TABLE saved_items(episode_id bigint REFERENCES episodes(id))`;
    await expect(inspect()).rejects.toThrow(
      'Unexpected foreign-key dependencies',
    );
  });

  test('refuses unhandled transcripts and catalog references', async () => {
    await sql`INSERT INTO transcripts(episode_id,content,source) VALUES (20,'fixture','fixture')`;
    await expect(inspect()).rejects.toThrow('Duplicate transcripts');
    await sql`DELETE FROM transcripts`;
    await sql`INSERT INTO genres(id,name) VALUES (1,'Fixture')`;
    await sql`INSERT INTO podcasts_genres(podcast_id,genre_id) VALUES (2,1)`;
    await expect(inspect()).rejects.toThrow('Duplicate catalog references');
  });

  test('refuses backup overwrite or unavailable storage', async () => {
    const { expectedPath } = await inspect();
    await expect(
      reconcile(sql, {
        plan,
        expectedPath,
        backupPath: expectedPath,
        mode: 'apply',
      }),
    ).rejects.toThrow();
    await expect(
      reconcile(sql, {
        plan,
        expectedPath,
        backupPath: join(directory, 'missing', 'backup.json'),
        mode: 'apply',
      }),
    ).rejects.toThrow();
    expect((await sql`SELECT count(*)::int AS n FROM episodes`)[0].n).toBe(6);
  });

  test('refuses reapplication and conflicting provider identities', async () => {
    await sql`UPDATE podcasts SET itunes_id=101 WHERE id=2`;
    await expect(inspect()).rejects.toThrow('Conflicting provider identities');
    await sql`UPDATE podcasts SET itunes_id=NULL WHERE id=2`;
    await apply();
    await expect(inspect()).rejects.toThrow('Expected two existing podcasts');
  });

  test('a verified backup restores and can replay the dry run', async () => {
    const { artifact } = await inspect();
    await apply();
    await sql`TRUNCATE podcasts CASCADE`;
    for (const table of [
      'podcasts',
      'episodes',
      'episode_content',
      'subscriptions',
      'playback_progress',
      'transcripts',
      'feed_poll_state',
      'podcasts_genres',
      'top_podcasts',
    ]) {
      const rows = artifact.snapshot[table];
      if (!rows.length) continue;
      await sql.unsafe(
        `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, $1::text::jsonb)`,
        [JSON.stringify(rows)],
      );
    }
    expect((await apply('dry-run'))?.retainedEpisodes).toBe(4);
  });

  test('preserves canonical progress and transcripts unchanged', async () => {
    await sql`INSERT INTO playback_progress(user_id,episode_id,position) VALUES ('listener',12,9)`;
    await sql`INSERT INTO transcripts(episode_id,content,source) VALUES (12,'canonical transcript','fixture')`;
    await apply();
    expect(
      (await sql`SELECT position FROM playback_progress WHERE episode_id=12`)[0]
        .position,
    ).toBe(9);
    expect(
      (await sql`SELECT content FROM transcripts WHERE episode_id=12`)[0]
        .content,
    ).toBe('canonical transcript');
  });

  test('refuses an active refresh lock', async () => {
    const other = postgres(cluster.options);
    try {
      await other.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(1::bigint)`;
        await expect(inspect()).rejects.toThrow('Feed refresh is active');
      });
    } finally {
      await other.end();
    }
  });

  test('refuses a third locator holder and user triggers', async () => {
    await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (3,'Third','https://feeds.example.invalid/third',1,'art')`;
    await expect(
      inspect({
        ...plan,
        canonicalFeedUrl: 'https://feeds.example.invalid/third',
      }),
    ).rejects.toThrow('Canonical locator belongs');
    await sql.unsafe(`CREATE FUNCTION fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER fixture_trigger BEFORE UPDATE ON podcasts FOR EACH ROW EXECUTE FUNCTION fixture_trigger()`);
    await expect(inspect()).rejects.toThrow(
      'User triggers require a tool review',
    );
  });

  test('rejects non-private artifact files and changed plans', async () => {
    const { expectedPath } = await inspect();
    chmodSync(expectedPath, 0o644);
    await expect(
      reconcile(sql, { plan, expectedPath, backupPath: path(), mode: 'apply' }),
    ).rejects.toThrow('private regular file');
    chmodSync(expectedPath, 0o600);
    const artifact = JSON.parse(readFileSync(expectedPath, 'utf8'));
    artifact.plan.canonicalId = 999;
    writeFileSync(expectedPath, JSON.stringify(artifact));
    await expect(
      reconcile(sql, { plan, expectedPath, backupPath: path(), mode: 'apply' }),
    ).rejects.toThrow('Reviewed plan mismatch');
  });
});

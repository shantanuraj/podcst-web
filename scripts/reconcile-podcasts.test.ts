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
import { digest, writeProtected } from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';
import { type ReconciliationPlan, reconcile } from './reconcile-podcasts';

const pgBin = process.env.PG_BIN;
let directory: string;
let sql: postgres.Sql;
let cluster: ReturnType<typeof startPostgres>;
let serial = 0;
const plan: ReconciliationPlan = {
  canonicalId: 1,
  duplicateId: 2,
  canonicalFeedUrl: 'https://feeds.example.invalid/current',
  sourceEvidenceReference: digest('Reviewed synthetic source equivalence'),
  reviewedIdentities: '',
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
SELECT id,guid,'https://media.example.invalid/'||guid||'.mp3' FROM episodes;
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
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await createSchemaFixture(sql);
    await sql.unsafe(seed);
    plan.reviewedIdentities = (await inspect()).result?.identitiesDigest;
    delete plan.reviewedMissingMedia;
  });

  test('the CLI honors the explicitly selected Unix socket instead of app defaults', async () => {
    const planPath = path();
    const backupPath = path();
    writeProtected(planPath, plan);
    const cli = new URL(
      import.meta.url.endsWith('.js')
        ? './reconcile-podcasts.js'
        : './reconcile-podcasts.ts',
      import.meta.url,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        cli.pathname,
        '--plan',
        planPath,
        '--backup',
        backupPath,
        '--mode',
        'inspect',
      ],
      {
        env: {
          ...process.env,
          RECONCILE_DATABASE_URL: cluster.url,
          DATABASE_URL: 'postgres://not-selected@127.0.0.1:1/not-selected',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(errors).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(output).mode).toBe('inspect');
    expect(
      JSON.parse(readFileSync(backupPath, 'utf8')).snapshot.podcasts.map(
        (p: { id: number }) => p.id,
      ),
    ).toEqual([1, 2]);
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
    await sql`DELETE FROM episode_content WHERE episode_id=11`;
    const { result: inspection } = await inspect();
    const result = await apply('apply', {
      ...plan,
      reviewedMissingMedia: inspection?.missingMediaDigest,
    });
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

  test('requires exact media-difference review and retains canonical media', async () => {
    await sql`UPDATE episode_content SET file_url='https://media.example.invalid/different.mp3' WHERE episode_id=20`;
    const { result, artifact } = await inspect();
    expect(artifact.mediaDifferences).toHaveLength(1);
    await expect(apply()).rejects.toThrow(
      'Shared media differences require exact review',
    );
    await apply('apply', {
      ...plan,
      reviewedMediaDifferences: result?.mediaDifferencesDigest,
    });
    expect(
      (await sql`SELECT file_url FROM episode_content WHERE episode_id=10`)[0]
        .file_url,
    ).toBe('https://media.example.invalid/shared-a.mp3');
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
    await sql`DELETE FROM episode_content WHERE episode_id=11`;
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
    ).rejects.toThrow('Missing-media cases require separate');
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
    await expect(apply()).rejects.toThrow(
      'Catalog reference changes require exact review',
    );
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

  test('requires exact provider-retirement review and refuses reapplication', async () => {
    await sql`UPDATE podcasts SET itunes_id=101,podcast_index_id=201 WHERE id=2`;
    const { result, artifact } = await inspect();
    const reviewed = { ...plan, reviewedIdentities: result?.identitiesDigest };
    expect(artifact.providerRetirements).toEqual([
      { podcastId: 2, field: 'itunes_id', value: 101 },
      { podcastId: 2, field: 'podcast_index_id', value: 201 },
    ]);
    await expect(apply('apply', reviewed)).rejects.toThrow(
      'Provider retirements require exact review',
    );
    await apply('apply', {
      ...reviewed,
      reviewedProviderRetirements: result?.providerRetirementsDigest,
    });
    expect(
      (await sql`SELECT itunes_id::int,podcast_index_id FROM podcasts`)[0],
    ).toEqual({ itunes_id: 100, podcast_index_id: 200 });
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM podcast_apple_aliases WHERE itunes_id=101`
      )[0].n,
    ).toBe(0);
    await expect(inspect()).rejects.toThrow('Expected two existing podcasts');
  });

  test('a verified alias-inclusive backup restores and can replay the dry run', async () => {
    await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://feeds.example.invalid/archived',2,'reviewed','archive-proof')`;
    await sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (101,1,'reviewed','listing-proof')`;
    plan.reviewedIdentities = (await inspect()).result?.identitiesDigest;
    const { artifact } = await inspect();
    expect(artifact.snapshot.podcast_feed_aliases).toHaveLength(1);
    expect(artifact.snapshot.podcast_apple_aliases).toHaveLength(1);
    await apply();
    await sql`TRUNCATE podcasts CASCADE`;
    for (const table of [
      'podcasts',
      'podcast_feed_aliases',
      'podcast_apple_aliases',
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

  test('requires explicit review of source and alias transitions', async () => {
    const unreviewed = { ...plan, reviewedIdentities: '' };
    const { expectedPath } = await inspect(unreviewed);
    await expect(
      reconcile(sql, {
        plan: unreviewed,
        expectedPath,
        backupPath: path(),
        mode: 'apply',
      }),
    ).rejects.toThrow('Source identities and alias changes');
    await expect(
      inspect({ ...plan, sourceEvidenceReference: '' }),
    ).rejects.toThrow('source-equivalence evidence digest');
  });

  test('preserves accepted aliases and registers old primary locators with reviewed evidence', async () => {
    await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference,evidence,accepted_at) VALUES
      ('https://feeds.example.invalid/canonical-history',1,'permanent_redirect','original-canonical','{"proof":1}','2026-01-01'),
      ('https://feeds.example.invalid/duplicate-history',2,'reviewed','original-duplicate','{"proof":2}','2026-01-02')`;
    await sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (101,1,'reviewed','verified-secondary')`;
    const { result } = await inspect();
    const reviewed = { ...plan, reviewedIdentities: result?.identitiesDigest };
    expect((await apply('dry-run', reviewed))?.retainedFeedAliases).toBe(3);
    await apply('apply', reviewed);
    expect(
      Array.from(
        await sql`SELECT feed_url,podcast_id::int,evidence_reference FROM podcast_feed_aliases ORDER BY feed_url`,
      ),
    ).toEqual([
      {
        feed_url: 'https://feeds.example.invalid/canonical-history',
        podcast_id: 1,
        evidence_reference: 'original-canonical',
      },
      {
        feed_url: 'https://feeds.example.invalid/duplicate-history',
        podcast_id: 1,
        evidence_reference: 'original-duplicate',
      },
      {
        feed_url: 'https://feeds.example.invalid/old',
        podcast_id: 1,
        evidence_reference: plan.sourceEvidenceReference,
      },
    ]);
    expect(
      (
        await sql`SELECT itunes_id::int,podcast_id::int FROM podcast_apple_aliases`
      )[0],
    ).toEqual({ itunes_id: 101, podcast_id: 1 });
    expect(
      (
        await sql`SELECT evidence,accepted_at='2026-01-02'::timestamptz AS original FROM podcast_feed_aliases WHERE evidence_reference='original-duplicate'`
      )[0],
    ).toEqual({ evidence: { proof: 2 }, original: true });
    await expect(
      sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (3,'Recreated','https://feeds.example.invalid/old',1,'art')`.execute(),
    ).rejects.toThrow('accepted alias');
  });

  test('can select an accepted duplicate locator while retaining both former primary locators', async () => {
    const future = 'https://feeds.example.invalid/future';
    await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES (${future},2,'reviewed','prior')`;
    const custom = { ...plan, canonicalFeedUrl: future };
    custom.reviewedIdentities = (
      await inspect(custom)
    ).result?.identitiesDigest;
    await apply('apply', custom);
    expect((await sql`SELECT feed_url FROM podcasts`)[0].feed_url).toBe(future);
    expect(
      (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
    ).toBe(2);
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases WHERE feed_url=${future}`
      )[0].n,
    ).toBe(0);
  });

  test.each([
    1, 2,
  ])('refuses private source %i without inferring ownership', async (id) => {
    await sql`UPDATE podcasts SET itunes_id=NULL,owner_user_id='listener' WHERE id=${id}`;
    await expect(inspect()).rejects.toThrow('two public sources');
    expect(
      (await sql`SELECT owner_user_id FROM podcasts WHERE id=${id}`)[0]
        .owner_user_id,
    ).toBe('listener');
  });

  test('refuses third-party accepted locator claims', async () => {
    await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (3,'Third','https://feeds.example.invalid/third',1,'art')`;
    await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://feeds.example.invalid/claimed',3,'reviewed','third-proof')`;
    await expect(
      inspect({
        ...plan,
        canonicalFeedUrl: 'https://feeds.example.invalid/claimed',
      }),
    ).rejects.toThrow('Canonical locator belongs');
  });

  test('binds accepted-alias evidence to the reviewed snapshot', async () => {
    const { expectedPath } = await inspect();
    await sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (101,1,'reviewed','new-proof')`;
    await expect(
      reconcile(sql, { plan, expectedPath, backupPath: path(), mode: 'apply' }),
    ).rejects.toThrow('Reviewed snapshot changed');
  });

  test.each([
    'ALTER TABLE podcast_feed_aliases DISABLE TRIGGER guard_public_feed_alias',
    'ALTER FUNCTION guard_public_apple_alias() SECURITY DEFINER',
    'ALTER FUNCTION guard_podcast_alias_claim() SET search_path TO public',
    'CREATE OR REPLACE FUNCTION guard_public_feed_alias() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',
  ])('refuses changed guard semantics: %s', async (change) => {
    await sql.unsafe(change);
    await expect(inspect()).rejects.toThrow(
      'User triggers require a tool review',
    );
  });

  test('refuses new alias dependents and row-security policies', async () => {
    await sql`CREATE TABLE saved_alias(feed_url text REFERENCES podcast_feed_aliases(feed_url) ON DELETE CASCADE)`;
    await expect(inspect()).rejects.toThrow(
      'Unexpected foreign-key dependencies',
    );
    await sql`DROP TABLE saved_alias`;
    await sql`ALTER TABLE podcasts ENABLE ROW LEVEL SECURITY`;
    await expect(inspect()).rejects.toThrow(
      'Relation policies require a tool review',
    );
  });

  test('requires review for missing media even without metadata differences', async () => {
    await sql`DELETE FROM episode_content WHERE episode_id IN (10,20)`;
    const { result } = await inspect();
    expect(result?.metadataDifferences).toBe(0);
    expect(result?.missingMediaDifferences).toBe(1);
    await expect(apply()).rejects.toThrow(
      'Missing-media cases require separate',
    );
    expect(
      (
        await apply('dry-run', {
          ...plan,
          reviewedMissingMedia: result?.missingMediaDigest,
        })
      )?.postconditionsVerified,
    ).toBe(true);
  });

  test.each([
    ['podcast:feed', 'https://feeds.example.invalid/history'],
    ['podcast:itunes', '101'],
    ['podcast:index', '200'],
  ])('coordinates the %s namespace for retained identities', async (namespace, value) => {
    await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://feeds.example.invalid/history',2,'reviewed','history')`;
    await sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (101,1,'reviewed','listing')`;
    const other = postgres(cluster.options);
    try {
      await other.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${namespace}),hashtext(${value}))`;
        await expect(inspect()).rejects.toThrow(
          'Feed identity import is active',
        );
      });
    } finally {
      await other.end();
    }
  });

  test('refuses stronger default isolation rather than changing it', async () => {
    const other = postgres({
      ...cluster.options,
      connection: { default_transaction_isolation: 'repeatable read' },
    });
    try {
      await expect(
        reconcile(other, { plan, backupPath: path(), mode: 'inspect' }),
      ).rejects.toThrow('requires read committed');
    } finally {
      await other.end();
    }
  });

  test('moves every episode into an explicitly reviewed empty canonical source', async () => {
    await sql`DELETE FROM episodes WHERE podcast_id=1`;
    const { result } = await inspect();
    expect(result?.emptyCanonical).toBe(true);
    await expect(apply()).rejects.toThrow(
      'Empty canonical source requires exact review',
    );
    const reviewed = {
      ...plan,
      reviewedEmptyCanonical: result?.emptyCanonicalDigest,
    };
    expect((await apply('dry-run', reviewed))?.retainedEpisodes).toBe(3);
    await apply('apply', reviewed);
    expect(
      Array.from(
        await sql`SELECT id::int,podcast_id::int FROM episodes ORDER BY id`,
      ),
    ).toEqual([
      { id: 20, podcast_id: 1 },
      { id: 21, podcast_id: 1 },
      { id: 22, podcast_id: 1 },
    ]);
    expect(
      (await sql`SELECT count(*)::int AS n FROM playback_progress`)[0].n,
    ).toBe(2);
  });

  test('does not infer correspondence between nonempty disjoint GUID sets', async () => {
    await sql`UPDATE episodes SET guid='other-'||guid WHERE podcast_id=2`;
    await expect(inspect()).rejects.toThrow(
      'Nonempty sources require shared episode identities',
    );
  });

  test('preserves genre union and the best original chart rank after exact review', async () => {
    await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (3,'Unrelated','https://feeds.example.invalid/unrelated',1,'art')`;
    await sql`INSERT INTO genres(id,name) VALUES (0,'All'),(1,'One'),(2,'Two')`;
    await sql`INSERT INTO countries(id,name) VALUES ('aa','First'),('bb','Second')`;
    await sql`INSERT INTO podcasts_genres VALUES (1,1),(2,1),(2,2)`;
    await sql`INSERT INTO top_podcasts(country_id,genre_id,rank,podcast_id,fetched_at) VALUES ('aa',0,5,1,'2026-01-02'),('aa',0,2,2,'2026-01-01'),('aa',0,9,2,'2026-01-03'),('bb',0,7,2,'2026-01-04'),('aa',0,3,3,'2026-01-05')`;
    const { result } = await inspect();
    await expect(apply()).rejects.toThrow(
      'Catalog reference changes require exact review',
    );
    const reviewed = {
      ...plan,
      reviewedCatalogChanges: result?.catalogChangesDigest,
    };
    await apply('dry-run', reviewed);
    expect((await sql`SELECT count(*)::int AS n FROM top_podcasts`)[0].n).toBe(
      5,
    );
    await apply('apply', reviewed);
    expect(
      Array.from(
        await sql`SELECT podcast_id::int,genre_id FROM podcasts_genres ORDER BY genre_id`,
      ),
    ).toEqual([
      { podcast_id: 1, genre_id: 1 },
      { podcast_id: 1, genre_id: 2 },
    ]);
    expect(
      Array.from(
        await sql`SELECT country_id,rank,podcast_id::int FROM top_podcasts ORDER BY country_id,rank`,
      ),
    ).toEqual([
      { country_id: 'aa', rank: 2, podcast_id: 1 },
      { country_id: 'aa', rank: 3, podcast_id: 3 },
      { country_id: 'bb', rank: 7, podcast_id: 1 },
    ]);
    expect(
      (
        await sql`SELECT fetched_at='2026-01-01'::timestamptz AS preserved FROM top_podcasts WHERE country_id='aa' AND rank=2`
      )[0].preserved,
    ).toBe(true);
  });

  test('does not retire accepted duplicate Apple aliases under primary-ID approval', async () => {
    await sql`UPDATE podcasts SET itunes_id=101 WHERE id=2`;
    await sql`INSERT INTO podcast_apple_aliases(itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (102,2,'reviewed','existing-claim')`;
    await expect(inspect()).rejects.toThrow(
      'Duplicate Apple aliases require separate',
    );
  });

  test('rejects an inexact reviewed exception digest', async () => {
    await sql`UPDATE episode_content SET file_url='https://media.example.invalid/revised.mp3' WHERE episode_id=20`;
    await expect(
      apply('apply', { ...plan, reviewedMediaDifferences: digest([]) }),
    ).rejects.toThrow('Shared media differences require exact review');
    await sql`UPDATE podcasts SET podcast_index_id=201 WHERE id=2`;
    const { result } = await inspect();
    await expect(
      apply('apply', {
        ...plan,
        reviewedIdentities: result?.identitiesDigest,
        reviewedMediaDifferences: result?.mediaDifferencesDigest,
        reviewedProviderRetirements: digest([]),
      }),
    ).rejects.toThrow('Provider retirements require exact review');
  });

  test('does not reinterpret version-two approvals under new repair policies', async () => {
    const { expectedPath } = await inspect();
    const artifact = JSON.parse(readFileSync(expectedPath, 'utf8'));
    artifact.version = 2;
    writeFileSync(expectedPath, JSON.stringify(artifact));
    await expect(
      reconcile(sql, { plan, expectedPath, backupPath: path(), mode: 'apply' }),
    ).rejects.toThrow('Reviewed plan mismatch');
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

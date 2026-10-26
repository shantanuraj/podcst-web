import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { adaptFeed } from '../src/app/api/feed/parser';
import {
  createEmailService,
  lockEmailIdentity,
} from '../src/server/auth/email-service';
import { reviewCodeDigest } from '../src/server/auth/review-credential';
import { assertImportScope } from '../src/server/ingest/import-scope';
import { createEpisodeListService } from '../src/server/lists/service';
import { samplerFeed } from '../src/server/review-sampler';
import { createFollowStateService } from '../src/server/state/follows';
import { readGeneration } from '../src/server/state/generation';
import { createProgressStateService } from '../src/server/state/progress';
import { digest } from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import {
  applyReviewAccount,
  inspectReviewOperation,
  planReviewAccount,
  type ReviewIdentity,
  type ReviewPlan,
  readReviewRegistration,
} from './lib/review-account';
import type { ResolvedReviewSeed } from './lib/review-seed';
import { reviewSeedReads } from './lib/review-verify';
import { loadMigrations, migrate } from './migrations';
import {
  captureSchema,
  type InventoryArtifact,
  inventoryArtifact,
} from './schema-catalog';

const secret = 'synthetic-review-secret'.repeat(3);
const sourceDigest = '1'.repeat(64);
const identity: ReviewIdentity = {
  store: 'apple',
  purpose: 'review',
  email: 'apple@example.invalid',
  target: 'development',
};
const google: ReviewIdentity = {
  store: 'google',
  purpose: 'review',
  email: 'google@example.invalid',
  target: 'development',
};
const code = '012345';

async function seedFor(store: string): Promise<ResolvedReviewSeed> {
  const feeds: ResolvedReviewSeed['feeds'] = [];
  for (const key of ['public', 'private'] as const) {
    const xml = samplerFeed(key, 'https://sampler.example.invalid');
    const data = await adaptFeed(xml);
    if (!data) throw new Error('Invalid fixture');
    feeds.push({
      key,
      url: `https://sampler.example.invalid/${key === 'public' ? 'public' : store}.xml`,
      fetched: {
        status: 'updated',
        data,
        hash: createHash('sha256').update(xml).digest('hex'),
        etag: null,
        lastModified: null,
      },
    });
  }
  return { revision: '1', feeds };
}

describe.skipIf(!process.env.PG_BIN)(
  'review preparation on disposable PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let reference: InventoryArtifact;
    let seed: ResolvedReviewSeed;
    let googleSeed: ResolvedReviewSeed;
    let auth: ReturnType<typeof createEmailService>;

    const makePlan = (
      action: ReviewPlan['action'],
      seedValue: ResolvedReviewSeed | null = seed,
      nextCode: string | null = null,
      account = identity,
    ) =>
      planReviewAccount(
        sql,
        {
          identity: account,
          action,
          submission: 'synthetic-build-1',
          sourceDigest,
          credentialDigest: nextCode
            ? reviewCodeDigest(secret, account.store, account.email, nextCode)
            : null,
        },
        reference,
        seedValue,
      );
    const apply = (
      plan: ReviewPlan,
      seedValue: ResolvedReviewSeed | null = seed,
    ) =>
      applyReviewAccount(sql, plan, {
        sourceDigest,
        credentialDigest: plan.credentialDigest,
        seed: seedValue,
        target: 'development',
      });
    const enroll = async (
      account = identity,
      seedValue = seed,
      accountCode = code,
    ) => {
      const plan = await makePlan('create', seedValue, accountCode, account);
      await apply(plan, seedValue);
      const registration = await readReviewRegistration(sql, account);
      if (!registration) throw new Error('Enrollment missing');
      return registration;
    };
    const capture = async (tables: string[], userId?: string) => {
      const result: Record<string, unknown> = {};
      for (const table of tables)
        result[table] = await sql`
      SELECT to_jsonb(t) AS row FROM ${sql(table)} t ${userId ? sql`WHERE user_id = ${userId}` : sql``}
      ORDER BY to_jsonb(t)::text
    `;
      return digest(result);
    };

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 10 });
      await migrate(sql);
      reference = inventoryArtifact(
        await captureSchema(sql),
        loadMigrations().map(({ name, checksum }) => ({ name, checksum })),
      );
      seed = await seedFor('apple');
      googleSeed = await seedFor('google');
      auth = createEmailService(sql, secret, async () => {});
    }, 30_000);

    beforeEach(async () => {
      await sql`TRUNCATE users, authors, email_verifications CASCADE`;
    });

    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    test('enrollment seeds normal state and refuses to adopt an existing email', async () => {
      await sql`INSERT INTO users (id, email) VALUES ('ordinary', 'APPLE@example.invalid')`;
      await expect(makePlan('create', seed, code)).rejects.toThrow('adopt');
      await sql`DELETE FROM users WHERE id = 'ordinary'`;
      const registered = await enroll();
      expect(await auth.login(identity.email, code)).not.toBeNull();
      expect(await auth.verify(identity.email, code)).toBe(false);
      const reads = await reviewSeedReads(sql, registered.user_id);
      expect(reads.reads).toHaveLength(5);
      expect(
        (await createFollowStateService(sql).read(registered.user_id)).revision,
      ).toBe('2');
      await expect(makePlan('create', seed, code)).rejects.toThrow(
        'already enrolled',
      );
    });

    test('E2E reset, rotation and removal preserve both reviewers and the other E2E account', async () => {
      const reviewer = await enroll();
      const otherReviewer = await enroll(google, googleSeed, '654321');
      const ios: ReviewIdentity = {
        ...identity,
        purpose: 'e2e',
        email: 'e2e.ios@example.invalid',
      };
      const android: ReviewIdentity = {
        ...google,
        purpose: 'e2e',
        email: 'e2e.android@example.invalid',
      };
      const iosSeed = await seedFor('e2e-ios');
      const androidSeed = await seedFor('e2e-android');
      const first = await enroll(ios, iosSeed, '111111');
      const other = await enroll(android, androidSeed, '222222');
      expect(
        await sql`SELECT store, purpose FROM review_accounts`,
      ).toHaveLength(4);
      for (const [account, credential] of [
        [identity, code],
        [google, '654321'],
        [android, '222222'],
      ] as const)
        expect(await auth.login(account.email, credential)).not.toBeNull();
      const preserved = [reviewer, otherReviewer, other];
      const tables = [
        'review_accounts',
        'sessions',
        'subscriptions',
        'playback_progress',
        'episode_lists',
      ];
      const before = await Promise.all(
        preserved.map((row) => capture(tables, row.user_id)),
      );
      await expect(
        makePlan('create', iosSeed, '333333', {
          ...ios,
          email: 'duplicate@example.invalid',
        }),
      ).rejects.toThrow('already enrolled');
      const session = await auth.login(ios.email, '111111');
      const reset = await makePlan('reset', iosSeed, null, ios);
      await apply(reset, iosSeed);
      const next = await readReviewRegistration(sql, ios);
      expect(next?.user_id).not.toBe(first.user_id);
      expect(next?.code_digest).toBe(first.code_digest);
      await reviewSeedReads(sql, next?.user_id ?? '');
      expect(
        await sql`SELECT id FROM sessions WHERE id = ${session?.id ?? ''}`,
      ).toHaveLength(0);
      expect(await auth.login(ios.email, '111111')).not.toBeNull();
      expect(await auth.login(identity.email, '111111')).toBeNull();
      expect(await auth.login(ios.email, code)).toBeNull();
      expect(await auth.verify(ios.email, '111111')).toBe(false);
      await expect(
        apply({ ...reset, identity: { ...ios, purpose: 'review' } }, iosSeed),
      ).rejects.toThrow('do not match');
      const rotate = await makePlan('rotate', null, '333333', ios);
      await apply(rotate, null);
      expect(await auth.login(ios.email, '111111')).toBeNull();
      expect(await auth.login(ios.email, '333333')).not.toBeNull();
      await apply(await makePlan('remove', null, null, ios), null);
      expect(await readReviewRegistration(sql, ios)).toBeUndefined();
      expect(await auth.login(ios.email, '333333')).toBeNull();
      expect(
        await Promise.all(preserved.map((row) => capture(tables, row.user_id))),
      ).toEqual(before);
    });

    test('seeds by column name across historical positions and still pins the planned layout', async () => {
      await sql`ALTER TABLE podcasts DROP COLUMN website_url`;
      await sql`ALTER TABLE podcasts ADD COLUMN discarded text`;
      await sql`ALTER TABLE podcasts DROP COLUMN discarded`;
      await sql`ALTER TABLE podcasts ADD COLUMN website_url text`;
      const registered = await enroll();
      await reviewSeedReads(sql, registered.user_id);
      expect(Array.from(await sql`SELECT website_url FROM podcasts`)).toEqual(
        seed.feeds.map(({ fetched }) => ({ website_url: fetched.data.link })),
      );
      const plan = await makePlan('reset');
      await sql`ALTER TABLE podcasts DROP COLUMN thumbnail`;
      await sql`ALTER TABLE podcasts ADD COLUMN thumbnail text`;
      await expect(apply(plan)).rejects.toThrow('schema changed');
      expect((await readReviewRegistration(sql, identity))?.user_id).toBe(
        registered.user_id,
      );
    });

    test('refuses planning and applying while the database collation version differs', async () => {
      const plan = await makePlan('create', seed, code);
      const [database] = await sql`
        SELECT datcollversion FROM pg_database WHERE datname = current_database()
      `;
      try {
        await sql`UPDATE pg_database SET datcollversion = 'synthetic-outdated' WHERE datname = current_database()`;
        await expect(makePlan('create', seed, code)).rejects.toThrow(
          'collation version',
        );
        await expect(apply(plan)).rejects.toThrow('collation version');
        expect(await readReviewRegistration(sql, identity)).toBeUndefined();
        expect(await sql`SELECT id FROM users`).toHaveLength(0);
      } finally {
        await sql`UPDATE pg_database SET datcollversion = ${database.datcollversion} WHERE datname = current_database()`;
      }
      await apply(plan);
      expect(await readReviewRegistration(sql, identity)).toBeDefined();
    });

    test('reset restores the baseline under a fresh identity without changing the other store or public catalogue', async () => {
      const first = await enroll();
      const other = await enroll(google, googleSeed, '654321');
      await sql`INSERT INTO users (id, email) VALUES ('ordinary', 'ordinary@example.invalid')`;
      const session = await auth.login(identity.email, code);
      await sql`INSERT INTO passkeys (id, user_id, credential_id, public_key) VALUES ('old-key', ${first.user_id}, 'old-credential', ${Buffer.from([1, 2, 3])})`;
      await sql`INSERT INTO oauth_accounts (provider, provider_account_id, user_id) VALUES ('synthetic', 'old-oauth', ${first.user_id})`;
      await auth.send(identity.email);
      const { scope } = await readGeneration(sql, first.user_id);
      const follows = createFollowStateService(sql);
      const followed = await follows.read(first.user_id);
      const oldBatch = {
        ...scope,
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ podcastId: followed.items[0].podcastId, followed: false }],
      };
      await follows.change(first.user_id, oldBatch);
      const oldLists = await createEpisodeListService(sql).lists(first.user_id);
      const plan = await makePlan('reset');
      const publicBefore =
        await sql`SELECT to_jsonb(p) AS row FROM podcasts p WHERE owner_user_id IS NULL`;
      const otherBefore = await capture(
        [
          'sessions',
          'subscriptions',
          'playback_progress',
          'episode_lists',
          'review_accounts',
        ],
        other.user_id,
      );
      const generationBefore = await sql`SELECT * FROM state_generation`;
      await apply(plan);
      const next = await readReviewRegistration(sql, identity);
      expect(next?.user_id).not.toBe(first.user_id);
      expect(next?.code_digest).toBe(first.code_digest);
      await reviewSeedReads(sql, next?.user_id ?? '');
      expect(await auth.login(identity.email, code)).not.toBeNull();
      expect(
        await sql`SELECT * FROM users WHERE id = ${first.user_id}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT * FROM sessions WHERE id = ${session?.id ?? ''}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT * FROM passkeys WHERE credential_id = 'old-credential'`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT * FROM oauth_accounts WHERE provider_account_id = 'old-oauth'`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT * FROM email_verifications WHERE email = ${identity.email}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT * FROM episode_lists WHERE id = ${oldLists.lists[0].id}`,
      ).toHaveLength(0);
      expect(Array.from(await sql`SELECT * FROM state_generation`)).toEqual(
        Array.from(generationBefore),
      );
      expect(
        Array.from(
          await sql`SELECT to_jsonb(p) AS row FROM podcasts p WHERE owner_user_id IS NULL`,
        ),
      ).toEqual(Array.from(publicBefore));
      expect(
        await capture(
          [
            'sessions',
            'subscriptions',
            'playback_progress',
            'episode_lists',
            'review_accounts',
          ],
          other.user_id,
        ),
      ).toBe(otherBefore);
      expect(await sql`SELECT * FROM users WHERE id = 'ordinary'`).toHaveLength(
        1,
      );
      await expect(
        follows.change(first.user_id, { ...oldBatch, sequence: '2' }),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
      await expect(
        follows.change(next?.user_id ?? '', { ...oldBatch, sequence: '2' }),
      ).rejects.toMatchObject({ code: 'account_mismatch' });
      await expect(
        sql.begin((tx) =>
          assertImportScope(
            tx,
            first.user_id,
            { generation: scope.generation, sessionId: session?.id },
            true,
          ),
        ),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    test('lost-result retries return the committed receipt and superseded plans cannot reset again', async () => {
      await enroll();
      const plan = await makePlan('reset', seed, '123456');
      const committed = await apply(plan);
      if (committed.action === 'remove') throw new Error('Unexpected removal');
      expect(await inspectReviewOperation(sql, plan)).toEqual(committed);
      expect(await apply(plan)).toEqual(committed);
      await expect(apply({ ...plan, submission: 'changed' })).rejects.toThrow(
        'different preparation inputs',
      );
      const later = await makePlan('reset');
      await apply(later);
      expect(await inspectReviewOperation(sql, plan)).toBeNull();
      await expect(apply(plan)).rejects.toThrow('identity changed');
      expect(await auth.login(identity.email, code)).toBeNull();
      expect(await auth.login(identity.email, '123456')).not.toBeNull();
    });

    test('refuses account edits, source changes, different credentials and the wrong target', async () => {
      const first = await enroll();
      const plan = await makePlan('reset');
      await expect(
        applyReviewAccount(sql, plan, {
          sourceDigest: '2'.repeat(64),
          credentialDigest: null,
          seed,
          target: 'development',
        }),
      ).rejects.toThrow('Source');
      await expect(
        applyReviewAccount(sql, plan, {
          sourceDigest,
          credentialDigest: '3'.repeat(64),
          seed,
          target: 'development',
        }),
      ).rejects.toThrow('credential');
      await expect(
        applyReviewAccount(sql, plan, {
          sourceDigest,
          credentialDigest: null,
          seed,
          target: 'production',
        }),
      ).rejects.toThrow('target');
      await sql`UPDATE account_preferences SET speed = 1.5 WHERE user_id = ${first.user_id}`;
      await expect(apply(plan)).rejects.toThrow('Account state changed');
      expect((await readReviewRegistration(sql, identity))?.user_id).toBe(
        first.user_id,
      );
    });

    test('refuses schema drift and missing or changed seed content', async () => {
      const first = await enroll();
      const plan = await makePlan('reset');
      await sql`ALTER TABLE review_accounts ADD COLUMN unexpected text`;
      try {
        await expect(apply(plan)).rejects.toThrow('schema changed');
      } finally {
        await sql`ALTER TABLE review_accounts DROP COLUMN unexpected`;
      }
      const replacement = await makePlan('reset');
      const changed = structuredClone(seed);
      changed.feeds[0].fetched.data.episodes[0].duration = 1;
      await expect(apply(replacement, changed)).rejects.toThrow('seed');
      expect((await readReviewRegistration(sql, identity))?.user_id).toBe(
        first.user_id,
      );
    });

    test('a mid-transaction catalogue failure leaves the previous account and credentials intact', async () => {
      const first = await enroll();
      const plan = await makePlan('reset');
      const before = await capture([
        'users',
        'sessions',
        'review_accounts',
        'subscriptions',
        'playback_progress',
        'episode_lists',
        'episode_list_items',
      ]);
      await sql`UPDATE episode_content SET title = 'changed public fixture' WHERE episode_id IN
      (SELECT e.id FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE p.owner_user_id IS NULL)`;
      await expect(apply(plan)).rejects.toThrow('catalogue content differs');
      expect(
        await capture([
          'users',
          'sessions',
          'review_accounts',
          'subscriptions',
          'playback_progress',
          'episode_lists',
          'episode_list_items',
        ]),
      ).toBe(before);
      expect((await readReviewRegistration(sql, identity))?.user_id).toBe(
        first.user_id,
      );
    });

    test('rotation revokes sessions, passkeys and pending OTPs without reseeding', async () => {
      const first = await enroll();
      await auth.login(identity.email, code);
      await auth.send(identity.email);
      await sql`INSERT INTO passkeys (id, user_id, credential_id, public_key) VALUES ('rotation-key', ${first.user_id}, 'rotation-credential', ${Buffer.from([1])})`;
      const state = await capture([
        'subscriptions',
        'playback_progress',
        'episode_lists',
        'episode_list_items',
      ]);
      await expect(makePlan('rotate', null, code)).rejects.toThrow(
        'different code',
      );
      await expect(makePlan('reset', seed, code)).rejects.toThrow(
        'different code',
      );
      const plan = await makePlan('rotate', null, '123456');
      await apply(plan, null);
      expect((await readReviewRegistration(sql, identity))?.user_id).toBe(
        first.user_id,
      );
      expect(
        await capture([
          'subscriptions',
          'playback_progress',
          'episode_lists',
          'episode_list_items',
        ]),
      ).toBe(state);
      expect(await sql`SELECT * FROM sessions`).toHaveLength(0);
      expect(await sql`SELECT * FROM passkeys`).toHaveLength(0);
      expect(await sql`SELECT * FROM email_verifications`).toHaveLength(0);
      expect(await auth.login(identity.email, code)).toBeNull();
      expect(await auth.login(identity.email, '123456')).not.toBeNull();
    });

    test('login before apply makes the plan stale and login queued behind reset uses the new identity', async () => {
      const first = await enroll();
      const stale = await makePlan('reset');
      await auth.login(identity.email, code);
      await expect(apply(stale)).rejects.toThrow('Account state changed');
      const plan = await makePlan('reset');
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const lock = sql.begin(async (tx) => {
        await lockEmailIdentity(tx, identity.email);
        held.resolve();
        await release.promise;
      });
      await held.promise;
      const resetting = apply(plan);
      await Bun.sleep(50);
      const loggingIn = auth.login(identity.email, code);
      release.resolve();
      await lock;
      await resetting;
      const session = await loggingIn;
      const [stored] =
        await sql`SELECT user_id FROM sessions WHERE id = ${session?.id ?? ''}`;
      expect(stored.user_id).not.toBe(first.user_id);
      expect(stored.user_id).toBe(
        (await readReviewRegistration(sql, identity))?.user_id,
      );
    });

    test('a concurrent state batch changes the fingerprint before reset can take the account lock', async () => {
      const first = await enroll();
      const plan = await makePlan('reset');
      const { scope } = await readGeneration(sql, first.user_id);
      const [episode] =
        await sql`SELECT episode_id::text AS id FROM playback_progress WHERE user_id = ${first.user_id} LIMIT 1`;
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const writing = createProgressStateService(sql, async () => {
        held.resolve();
        await release.promise;
      }).change(first.user_id, {
        ...scope,
        clientId: randomUUID(),
        sequence: '1',
        changes: [
          { episodeId: episode.id, positionSeconds: 10, completed: null },
        ],
      });
      await held.promise;
      const resetting = apply(plan);
      release.resolve();
      await writing;
      await expect(resetting).rejects.toThrow('Account state changed');
    });

    test('a foreign list reference to an owned private episode blocks reset', async () => {
      const first = await enroll();
      await sql`INSERT INTO users (id, email) VALUES ('foreign', 'foreign@example.invalid')`;
      const id = randomUUID();
      await sql`INSERT INTO episode_lists (id, user_id, kind) VALUES (${id}, 'foreign', 'starred')`;
      const [episode] =
        await sql`SELECT e.id FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE p.owner_user_id = ${first.user_id} LIMIT 1`;
      await sql`INSERT INTO episode_list_items (list_id, episode_id) VALUES (${id}, ${episode.id})`;
      await expect(makePlan('reset')).rejects.toThrow('another account');
    });

    test('removal disables reusable access while leaving the ordinary account intact', async () => {
      const first = await enroll();
      const plan = await makePlan('remove', null);
      await apply(plan, null);
      expect(await readReviewRegistration(sql, identity)).toBeUndefined();
      expect(await auth.login(identity.email, code)).toBeNull();
      expect(
        await sql`SELECT * FROM users WHERE id = ${first.user_id}`,
      ).toHaveLength(1);
    });
  },
);

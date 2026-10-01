import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';

type Row = postgres.Row;
type Snapshot = Record<string, Row[]>;

export interface ReconciliationPlan {
  canonicalId: number;
  duplicateId: number;
  canonicalFeedUrl: string;
  reviewedDifferences: string;
}

interface Options {
  plan: ReconciliationPlan;
  backupPath: string;
  expectedPath?: string;
  mode: 'inspect' | 'dry-run' | 'apply';
}

const tables = {
  podcasts: ['t.id', 't.id'],
  episodes: ['t.podcast_id', 't.id'],
  episode_content: [
    'e.podcast_id',
    't.episode_id',
    'JOIN public.episodes e ON e.id = t.episode_id',
  ],
  subscriptions: ['t.podcast_id', 't.user_id, t.podcast_id'],
  playback_progress: [
    'e.podcast_id',
    't.user_id, t.episode_id',
    'JOIN public.episodes e ON e.id = t.episode_id',
  ],
  transcripts: [
    'e.podcast_id',
    't.episode_id',
    'JOIN public.episodes e ON e.id = t.episode_id',
  ],
  feed_poll_state: ['t.podcast_id', 't.podcast_id'],
  podcasts_genres: ['t.podcast_id', 't.podcast_id, t.genre_id'],
  top_podcasts: ['t.podcast_id', 't.country_id, t.genre_id, t.rank'],
} as const;

const expectedForeignKeys = [
  ['episode_content', 'episode_id', 'episodes', 'id'],
  ['episodes', 'podcast_id', 'podcasts', 'id'],
  ['feed_poll_state', 'podcast_id', 'podcasts', 'id'],
  ['playback_progress', 'episode_id', 'episodes', 'id'],
  ['podcasts_genres', 'podcast_id', 'podcasts', 'id'],
  ['subscriptions', 'podcast_id', 'podcasts', 'id'],
  ['top_podcasts', 'podcast_id', 'podcasts', 'id'],
  ['transcripts', 'episode_id', 'episodes', 'id'],
]
  .map((parts) => parts.join(':'))
  .sort();

export function stable(value: unknown): string {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  ) {
    throw new Error('Unsafe integer in reconciliation data');
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  invariant(encoded !== undefined, 'Value is not JSON serializable');
  return encoded;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function protectedParent(path: string) {
  const directory = realpathSync(dirname(resolve(path)));
  const stat = lstatSync(directory);
  invariant(
    stat.isDirectory() && (stat.mode & 0o077) === 0,
    'Artifact directory must be private',
  );
  invariant(
    stat.uid === process.getuid?.(),
    'Artifact directory must belong to the operator',
  );
}

function readProtected(path: string) {
  protectedParent(path);
  const stat = lstatSync(path);
  invariant(
    stat.isFile() &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid?.(),
    'Artifact must be an operator-owned private regular file',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

function backup(path: string, value: unknown) {
  protectedParent(path);
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, stable(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  invariant(
    digest(readProtected(path)) === digest(value),
    'Backup read-back failed',
  );
  const directory = openSync(dirname(resolve(path)), constants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export async function snapshot(
  tx: postgres.TransactionSql,
  ids: number[],
  lock = false,
): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const [table, [column, order, join = '']] of Object.entries(tables)) {
    const rows = await tx.unsafe(
      `SELECT to_jsonb(t) AS data FROM public.${table} t ${join} WHERE ${column} IN ($1::bigint, $2::bigint) ORDER BY ${order}${lock ? ' FOR UPDATE OF t' : ''}`,
      ids,
    );
    result[table] = rows.map((row) => row.data);
  }
  stable(result);
  return result;
}

export function analyze(state: Snapshot, plan: ReconciliationPlan) {
  const canonical = state.podcasts.find((row) => row.id === plan.canonicalId);
  const duplicate = state.podcasts.find((row) => row.id === plan.duplicateId);
  invariant(
    state.podcasts.length === 2 && canonical && duplicate,
    'Expected two distinct podcast records',
  );
  invariant(
    !('visibility' in canonical) && !('owner_user_id' in canonical),
    'Ownership schema requires a new tool review',
  );
  invariant(
    canonical.itunes_id !== null,
    'Canonical record requires verified provider identity',
  );
  invariant(
    (duplicate.itunes_id === null ||
      duplicate.itunes_id === canonical.itunes_id) &&
      (duplicate.podcast_index_id === null ||
        duplicate.podcast_index_id === canonical.podcast_index_id),
    'Conflicting provider identities',
  );
  const episodes = new Map(
    state.episodes
      .filter((row) => row.podcast_id === plan.canonicalId)
      .map((row) => [row.guid, row]),
  );
  const content = new Map(
    state.episode_content.map((row) => [row.episode_id, row]),
  );
  const moves: { from: number; to: number }[] = [];
  const unique: number[] = [];
  const differences: Row[] = [];
  for (const source of state.episodes.filter(
    (row) => row.podcast_id === plan.duplicateId,
  )) {
    const target = episodes.get(source.guid);
    if (!target) {
      unique.push(source.id);
      continue;
    }
    const a = content.get(target.id);
    const b = content.get(source.id);
    invariant(
      !a || !b || a.file_url === b.file_url,
      'Shared episode media differs',
    );
    if (
      target.published !== source.published ||
      (a && b && a.title !== b.title)
    ) {
      invariant(
        a && b && a.file_url === b.file_url,
        'Metadata difference lacks matching media evidence',
      );
      differences.push({
        guid: source.guid,
        canonicalPublished: target.published,
        duplicatePublished: source.published,
        canonicalTitle: a.title,
        duplicateTitle: b.title,
      });
    }
    moves.push({ from: source.id, to: target.id });
  }
  invariant(moves.length > 0, 'No shared episode identities');
  const map = new Map(moves.map((move) => [move.from, move.to]));
  const sourceIds = new Set(
    state.episodes
      .filter((row) => row.podcast_id === plan.duplicateId)
      .map((row) => row.id),
  );
  invariant(
    !state.transcripts.some((row) => sourceIds.has(row.episode_id)),
    'Duplicate transcripts require manual reconciliation',
  );
  invariant(
    !state.podcasts_genres.some((row) => row.podcast_id === plan.duplicateId) &&
      !state.top_podcasts.some((row) => row.podcast_id === plan.duplicateId),
    'Duplicate catalog references require manual reconciliation',
  );
  const progressKeys = new Set<string>();
  for (const row of state.playback_progress) {
    const key = stable([
      row.user_id,
      map.get(row.episode_id) ?? row.episode_id,
    ]);
    invariant(
      !progressKeys.has(key),
      'Playback progress conflict requires an explicit decision',
    );
    progressKeys.add(key);
  }
  differences.sort((a, b) => a.guid.localeCompare(b.guid));
  return { moves, unique, differences, differencesDigest: digest(differences) };
}

function without(row: Row, keys: string[]) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !keys.includes(key)),
  );
}

function sameRows(a: Row[], b: Row[]) {
  return stable(a.map(stable).sort()) === stable(b.map(stable).sort());
}

export async function reconcile(sql: postgres.Sql, options: Options) {
  const { plan, mode } = options;
  invariant(
    ['inspect', 'dry-run', 'apply'].includes(mode),
    'Invalid execution mode',
  );
  invariant(
    [plan.canonicalId, plan.duplicateId].every(
      (id) => Number.isSafeInteger(id) && id > 0,
    ) && plan.canonicalId !== plan.duplicateId,
    'Invalid podcast IDs',
  );
  const feed = new URL(plan.canonicalFeedUrl);
  invariant(
    feed.protocol === 'https:' &&
      !feed.username &&
      !feed.password &&
      !feed.hash,
    'Canonical locator must be a verified HTTPS public feed',
  );
  const expected =
    mode === 'inspect' ? null : readProtected(options.expectedPath ?? '');
  if (expected)
    invariant(
      expected.version === 1 && stable(expected.plan) === stable(plan),
      'Reviewed plan mismatch',
    );
  const ids = [plan.canonicalId, plan.duplicateId];
  const rolledBack = new Error('Reconciliation dry run');
  let result: Row | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '30s'`;
      await tx`SET LOCAL lock_timeout = '5s'`;
      await tx`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
      await tx`SET LOCAL timezone = 'UTC'`;
      for (const id of [...ids].sort((a, b) => a - b)) {
        const [lock] =
          await tx`SELECT pg_try_advisory_xact_lock(${id}::bigint) AS acquired`;
        invariant(lock.acquired, 'Feed refresh is active');
      }
      const initial =
        await tx`SELECT id, feed_url, itunes_id FROM public.podcasts WHERE id IN (${ids[0]}, ${ids[1]}) ORDER BY id`;
      invariant(initial.length === 2, 'Expected two existing podcasts');
      const claims = [
        ...new Set(
          initial
            .map((row) => `podcast:feed\u001f${row.feed_url}`)
            .concat(
              `podcast:feed\u001f${plan.canonicalFeedUrl}`,
              initial
                .filter((row) => row.itunes_id !== null)
                .map((row) => `podcast:itunes\u001f${row.itunes_id}`),
            ),
        ),
      ].sort();
      for (const claim of claims) {
        const [namespace, value] = claim.split('\u001f');
        const [lock] =
          await tx`SELECT pg_try_advisory_xact_lock(hashtext(${namespace}), hashtext(${value})) AS acquired`;
        invariant(lock.acquired, 'Feed identity import is active');
      }
      const keys = await tx`
        SELECT ns.nspname AS schema, child.relname AS child, parent.relname AS parent,
          ARRAY(SELECT attname FROM pg_attribute WHERE attrelid=c.conrelid AND attnum=ANY(c.conkey) ORDER BY attnum) AS child_columns,
          ARRAY(SELECT attname FROM pg_attribute WHERE attrelid=c.confrelid AND attnum=ANY(c.confkey) ORDER BY attnum) AS parent_columns
        FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid
        JOIN pg_namespace ns ON ns.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid
        WHERE c.contype='f' AND c.confrelid IN ('public.podcasts'::regclass,'public.episodes'::regclass)
      `;
      invariant(
        keys.every((row) => row.schema === 'public') &&
          stable(
            keys
              .map(
                (row) =>
                  `${row.child}:${row.child_columns.join(',')}:${row.parent}:${row.parent_columns.join(',')}`,
              )
              .sort(),
          ) === stable(expectedForeignKeys),
        'Unexpected foreign-key dependencies',
      );
      const triggers = await tx`
        SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.podcasts'::regclass,'public.episodes'::regclass,
            'public.episode_content'::regclass,'public.subscriptions'::regclass,
            'public.playback_progress'::regclass,'public.transcripts'::regclass,
            'public.feed_poll_state'::regclass,'public.podcasts_genres'::regclass,
            'public.top_podcasts'::regclass)
      `;
      invariant(triggers.length === 0, 'User triggers require a tool review');
      const conflictingLocator = await tx`
        SELECT 1 FROM public.podcasts WHERE feed_url=${plan.canonicalFeedUrl}
          AND id NOT IN (${ids[0]},${ids[1]})
      `;
      invariant(
        conflictingLocator.length === 0,
        'Canonical locator belongs to another record',
      );
      const before = await snapshot(tx, ids, true);
      invariant(
        initial.every((row) =>
          before.podcasts.some(
            (p) =>
              String(p.id) === String(row.id) &&
              p.feed_url === row.feed_url &&
              String(p.itunes_id) === String(row.itunes_id),
          ),
        ),
        'Source identity changed while acquiring locks',
      );
      const analysis = analyze(before, plan);
      if (mode !== 'inspect') {
        invariant(
          stable(before) === stable(expected.snapshot),
          'Reviewed snapshot changed; inspect again',
        );
        invariant(
          plan.reviewedDifferences === analysis.differencesDigest,
          'Metadata differences have not been reviewed',
        );
      }
      const artifact = {
        version: 1,
        capturedAt: new Date().toISOString(),
        plan,
        snapshot: before,
        episodeMap: analysis.moves,
        uniqueEpisodeIds: analysis.unique,
        differences: analysis.differences,
        differencesDigest: analysis.differencesDigest,
      };
      backup(options.backupPath, artifact);
      result = {
        mode,
        sharedEpisodes: analysis.moves.length,
        retainedUniqueEpisodes: analysis.unique.length,
        metadataDifferences: analysis.differences.length,
        differencesDigest: analysis.differencesDigest,
        backupVerified: true,
      };
      if (mode === 'inspect') throw rolledBack;
      const mapping = tx.json(analysis.moves);
      await tx`
        INSERT INTO public.episode_content (episode_id,title,summary,duration,episode_art,file_url,file_length,file_type)
        SELECT m."to",c.title,c.summary,c.duration,c.episode_art,c.file_url,c.file_length,c.file_type
        FROM jsonb_to_recordset(${mapping}::jsonb) AS m("from" bigint,"to" bigint)
        JOIN public.episode_content c ON c.episode_id=m."from"
        ON CONFLICT (episode_id) DO NOTHING
      `;
      await tx`
        UPDATE public.playback_progress p SET episode_id=m."to"
        FROM jsonb_to_recordset(${mapping}::jsonb) AS m("from" bigint,"to" bigint)
        WHERE p.episode_id=m."from"
      `;
      await tx`
        INSERT INTO public.subscriptions (user_id,podcast_id,subscribed_at)
        SELECT user_id,${plan.canonicalId},min(subscribed_at) FROM public.subscriptions
        WHERE podcast_id IN (${ids[0]},${ids[1]}) GROUP BY user_id
        ON CONFLICT (user_id,podcast_id) DO UPDATE SET subscribed_at=least(subscriptions.subscribed_at,EXCLUDED.subscribed_at)
      `;
      await tx`
        DELETE FROM public.episodes e USING jsonb_to_recordset(${mapping}::jsonb) AS m("from" bigint,"to" bigint)
        WHERE e.id=m."from" AND e.podcast_id=${plan.duplicateId}
      `;
      await tx`UPDATE public.episodes SET podcast_id=${plan.canonicalId} WHERE podcast_id=${plan.duplicateId}`;
      await tx`DELETE FROM public.podcasts WHERE id=${plan.duplicateId}`;
      const canonicalBefore = before.podcasts.find(
        (row) => row.id === plan.canonicalId,
      );
      invariant(canonicalBefore, 'Canonical snapshot missing');
      const dates = before.podcasts
        .map((row) => row.last_accessed_at)
        .filter(Boolean)
        .sort();
      await tx`
        UPDATE public.podcasts SET feed_url=${plan.canonicalFeedUrl},
          episode_count=(SELECT count(*) FROM public.episodes WHERE podcast_id=${plan.canonicalId}),
          is_essential=${before.podcasts.some((row) => row.is_essential) || before.subscriptions.length > 0 || before.playback_progress.length > 0},
          last_accessed_at=${dates.at(-1) ?? null}, updated_at=now()
        WHERE id=${plan.canonicalId}
      `;
      await tx`
        INSERT INTO public.feed_poll_state (podcast_id,next_poll_at,failures) VALUES (${plan.canonicalId},now(),0)
        ON CONFLICT (podcast_id) DO UPDATE SET etag=NULL,last_modified=NULL,hash=NULL,last_polled_at=NULL,next_poll_at=EXCLUDED.next_poll_at,failures=0
      `;
      const after = await snapshot(tx, ids);
      const map = new Map(analysis.moves.map((move) => [move.from, move.to]));
      const expectedEpisodes = before.episodes
        .filter((row) => !map.has(row.id))
        .map((row) => ({ ...row, podcast_id: plan.canonicalId }));
      const expectedContent = new Map(
        before.episode_content
          .filter((row) => !map.has(row.episode_id))
          .map((row) => [row.episode_id, row]),
      );
      for (const row of before.episode_content) {
        const target = map.get(row.episode_id);
        if (target && !expectedContent.has(target))
          expectedContent.set(target, { ...row, episode_id: target });
      }
      const expectedProgress = before.playback_progress.map((row) => ({
        ...row,
        episode_id: map.get(row.episode_id) ?? row.episode_id,
      }));
      const expectedSubscriptions = new Map<string, Row>();
      for (const row of before.subscriptions) {
        const prior = expectedSubscriptions.get(row.user_id);
        if (!prior || row.subscribed_at < prior.subscribed_at)
          expectedSubscriptions.set(row.user_id, {
            ...row,
            podcast_id: plan.canonicalId,
          });
      }
      invariant(
        after.podcasts.length === 1 &&
          after.podcasts[0].id === plan.canonicalId &&
          after.podcasts[0].feed_url === plan.canonicalFeedUrl,
        'Canonical identity postcondition failed',
      );
      invariant(
        stable(
          without(after.podcasts[0], [
            'feed_url',
            'episode_count',
            'is_essential',
            'last_accessed_at',
            'updated_at',
          ]),
        ) ===
          stable(
            without(canonicalBefore, [
              'feed_url',
              'episode_count',
              'is_essential',
              'last_accessed_at',
              'updated_at',
            ]),
          ),
        'Canonical metadata changed unexpectedly',
      );
      invariant(
        sameRows(after.episodes, expectedEpisodes),
        'Episode identity preservation failed',
      );
      invariant(
        sameRows(after.episode_content, [...expectedContent.values()]),
        'Episode content preservation failed',
      );
      invariant(
        sameRows(after.playback_progress, expectedProgress),
        'Playback state preservation failed',
      );
      invariant(
        sameRows(after.subscriptions, [...expectedSubscriptions.values()]),
        'Subscription preservation failed',
      );
      for (const table of ['transcripts', 'podcasts_genres', 'top_podcasts'])
        invariant(
          sameRows(after[table], before[table]),
          'Catalog references changed unexpectedly',
        );
      const poll = after.feed_poll_state[0];
      invariant(
        after.feed_poll_state.length === 1 &&
          poll.podcast_id === plan.canonicalId &&
          poll.etag === null &&
          poll.last_modified === null &&
          poll.hash === null &&
          poll.last_polled_at === null &&
          poll.failures === 0,
        'Polling reset failed',
      );
      result = {
        ...result,
        retainedEpisodes: after.episodes.length,
        retainedContent: after.episode_content.length,
        retainedProgress: after.playback_progress.length,
        retainedSubscriptions: after.subscriptions.length,
        postconditionsVerified: true,
      };
      if (mode === 'dry-run') throw rolledBack;
    });
  } catch (error) {
    if (error !== rolledBack) throw error;
  }
  return result;
}

if (import.meta.main) {
  let sql: postgres.Sql | undefined;
  try {
    const args = new Map<string, string>();
    const input = process.argv.slice(2);
    invariant(input.length % 2 === 0, 'Expected named option/value pairs');
    for (let i = 0; i < input.length; i += 2) {
      invariant(
        ['--plan', '--backup', '--expected', '--mode'].includes(input[i]) &&
          !args.has(input[i]),
        'Unknown or duplicate option',
      );
      args.set(input[i], input[i + 1]);
    }
    invariant(
      process.env.RECONCILE_DATABASE_URL,
      'RECONCILE_DATABASE_URL must explicitly select a database',
    );
    const planPath = args.get('--plan');
    const backupPath = args.get('--backup');
    invariant(planPath && backupPath, 'Plan and backup paths are required');
    const plan = readProtected(planPath) as ReconciliationPlan;
    sql = postgres(process.env.RECONCILE_DATABASE_URL, {
      max: 1,
      connect_timeout: 10,
    });
    const result = await reconcile(sql, {
      plan,
      backupPath,
      expectedPath: args.get('--expected'),
      mode: (args.get('--mode') ?? 'inspect') as Options['mode'],
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Reconciliation failed',
    );
    process.exitCode = 1;
  } finally {
    await sql?.end({ timeout: 5 });
  }
}

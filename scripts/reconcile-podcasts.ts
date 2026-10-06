import type postgres from 'postgres';
import { digest, readProtected, stable, writeProtected } from './lib/artifacts';
import { openDatabase } from './lib/database';
import { verifyReconciliationTriggers } from './reconciliation-schema';

type Row = postgres.Row;
type Snapshot = Record<string, Row[]>;

export interface ReconciliationPlan {
  canonicalId: number;
  duplicateId: number;
  canonicalFeedUrl: string;
  sourceEvidenceReference: string;
  reviewedIdentities: string;
  reviewedDifferences: string;
  reviewedMissingMedia?: string;
  reviewedMediaDifferences?: string;
  reviewedProviderRetirements?: string;
  reviewedEmptyCanonical?: string;
  reviewedCatalogChanges?: string;
  reactivateCanonical?: boolean;
}

interface Options {
  plan: ReconciliationPlan;
  backupPath: string;
  expectedPath?: string;
  mode: 'inspect' | 'dry-run' | 'apply';
}

const tables = {
  podcasts: ['t.id', 't.id'],
  podcast_feed_aliases: ['t.podcast_id', 't.feed_url'],
  podcast_apple_aliases: ['t.podcast_id', 't.itunes_id'],
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
  chart_history: ['t.podcast_id', 't.country_id, t.day, t.podcast_id'],
} as const;

const expectedForeignKeys = [
  ['chart_history', 'podcast_id', 'podcasts', 'id'],
  ['episode_content', 'episode_id', 'episodes', 'id'],
  ['episode_list_items', 'episode_id', 'episodes', 'id'],
  ['episodes', 'podcast_id', 'podcasts', 'id'],
  ['feed_poll_state', 'podcast_id', 'podcasts', 'id'],
  ['playback_progress', 'episode_id', 'episodes', 'id'],
  ['podcast_feed_aliases', 'podcast_id', 'podcasts', 'id'],
  ['podcast_apple_aliases', 'podcast_id', 'podcasts', 'id'],
  ['podcasts_genres', 'podcast_id', 'podcasts', 'id'],
  ['subscriptions', 'podcast_id', 'podcasts', 'id'],
  ['top_podcasts', 'podcast_id', 'podcasts', 'id'],
  ['transcripts', 'episode_id', 'episodes', 'id'],
]
  .map((parts) => parts.join(':'))
  .sort();

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function snapshot(
  tx: postgres.TransactionSql,
  ids: number[],
  lock = false,
): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const [table, [column, order, join = '']] of Object.entries(tables)) {
    const rows = await tx.unsafe(
      `SELECT to_jsonb(t) AS data FROM public.${table} t ${join} WHERE ${column} IN ($1::bigint, $2::bigint) ORDER BY ${order} LIMIT 20001${lock ? ' FOR UPDATE OF t' : ''}`,
      ids,
    );
    invariant(rows.length <= 20000, 'Affected-row bound exceeded');
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
    state.podcasts.every(
      (row) =>
        Object.hasOwn(row, 'owner_user_id') && row.owner_user_id === null,
    ),
    'Reconciliation requires two public sources on the ownership schema',
  );
  invariant(
    canonical.itunes_id !== null,
    'Canonical record requires verified provider identity',
  );
  const providerRetirements = ['itunes_id', 'podcast_index_id']
    .filter(
      (field) =>
        duplicate[field] !== null && duplicate[field] !== canonical[field],
    )
    .map((field) => ({
      podcastId: plan.duplicateId,
      field,
      value: duplicate[field],
    }));
  invariant(
    state.podcast_apple_aliases.every(
      (row) => row.podcast_id === plan.canonicalId,
    ),
    'Duplicate Apple aliases require separate provider reconciliation',
  );
  const feedAliases = new Map<string, Row>(
    state.podcast_feed_aliases
      .filter((row) => row.feed_url !== plan.canonicalFeedUrl)
      .map((row) => [row.feed_url, { ...row, podcast_id: plan.canonicalId }]),
  );
  for (const row of state.podcasts) {
    if (row.feed_url === plan.canonicalFeedUrl || feedAliases.has(row.feed_url))
      continue;
    feedAliases.set(row.feed_url, {
      feed_url: row.feed_url,
      podcast_id: plan.canonicalId,
      evidence_type: 'reviewed',
      evidence_reference: plan.sourceEvidenceReference,
      evidence: {
        canonicalId: plan.canonicalId,
        duplicateId: plan.duplicateId,
      },
    });
  }
  const identities = {
    sources: state.podcasts.map(
      ({ id, feed_url, itunes_id, podcast_index_id, owner_user_id }) => ({
        id,
        feed_url,
        itunes_id,
        podcast_index_id,
        owner_user_id,
      }),
    ),
    canonicalFeedUrl: plan.canonicalFeedUrl,
    feedAliases: [...feedAliases.values()].sort((a, b) =>
      a.feed_url.localeCompare(b.feed_url),
    ),
    appleAliases: state.podcast_apple_aliases,
    sourceEvidenceReference: plan.sourceEvidenceReference,
    providerRetirements,
    ...(plan.reactivateCanonical ? { reactivateCanonical: true } : {}),
  };
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
  const missingMedia: Row[] = [];
  const mediaDifferences: Row[] = [];
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
    if (a && b && a.file_url !== b.file_url)
      mediaDifferences.push({
        guid: source.guid,
        canonicalEpisodeId: target.id,
        duplicateEpisodeId: source.id,
        canonicalMedia: a.file_url,
        duplicateMedia: b.file_url,
      });
    const difference = {
      guid: source.guid,
      canonicalPublished: target.published,
      duplicatePublished: source.published,
      canonicalTitle: a?.title ?? null,
      duplicateTitle: b?.title ?? null,
    };
    if (
      target.published !== source.published ||
      (a && b && a.title !== b.title)
    )
      differences.push(difference);
    if (!a || !b) {
      missingMedia.push({
        ...difference,
        canonicalMedia: a?.file_url ?? null,
        duplicateMedia: b?.file_url ?? null,
      });
    }
    moves.push({ from: source.id, to: target.id });
  }
  invariant(
    moves.length > 0 || episodes.size === 0,
    'Nonempty sources require shared episode identities',
  );
  const emptyCanonical =
    episodes.size === 0
      ? {
          canonicalId: plan.canonicalId,
          duplicateId: plan.duplicateId,
          retainedEpisodeIds: unique,
          sourceEvidenceReference: plan.sourceEvidenceReference,
        }
      : null;
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
  const genres = new Map<number, Row>();
  for (const row of state.podcasts_genres)
    if (!genres.has(row.genre_id) || row.podcast_id === plan.canonicalId)
      genres.set(row.genre_id, { ...row, podcast_id: plan.canonicalId });
  const charts = new Map<string, Row>();
  for (const row of state.top_podcasts) {
    const key = stable([row.country_id, row.genre_id]);
    const prior = charts.get(key);
    if (!prior || row.rank < prior.rank)
      charts.set(key, { ...row, podcast_id: plan.canonicalId });
  }
  const history = new Map<string, Row>();
  for (const row of state.chart_history) {
    const key = stable([row.country_id, row.day]);
    const prior = history.get(key);
    if (!prior || row.rank < prior.rank)
      history.set(key, { ...row, podcast_id: plan.canonicalId });
  }
  const catalog = {
    podcasts_genres: [...genres.values()].sort(
      (a, b) => a.genre_id - b.genre_id,
    ),
    top_podcasts: [...charts.values()].sort((a, b) =>
      stable([a.country_id, a.genre_id]).localeCompare(
        stable([b.country_id, b.genre_id]),
      ),
    ),
    chart_history: [...history.values()].sort((a, b) =>
      stable([a.country_id, a.day]).localeCompare(
        stable([b.country_id, b.day]),
      ),
    ),
  };
  const catalogChanges = Object.entries(catalog).some(
    ([table, rows]) => !sameRows(rows, state[table]),
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
  missingMedia.sort((a, b) => a.guid.localeCompare(b.guid));
  mediaDifferences.sort((a, b) => a.guid.localeCompare(b.guid));
  return {
    providerRetirements,
    providerRetirementsDigest: digest(providerRetirements),
    mediaDifferences,
    mediaDifferencesDigest: digest(mediaDifferences),
    emptyCanonical,
    emptyCanonicalDigest: digest(emptyCanonical),
    catalog,
    catalogChanges,
    catalogChangesDigest: digest(catalog),
    identities,
    identitiesDigest: digest(identities),
    moves,
    unique,
    differences,
    missingMedia,
    missingMediaDigest: digest(missingMedia),
    differencesDigest: digest(differences),
  };
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
  invariant(
    /^[a-f0-9]{64}$/.test(plan.sourceEvidenceReference),
    'Protected source-equivalence evidence digest required',
  );
  invariant(
    plan.reactivateCanonical === undefined ||
      typeof plan.reactivateCanonical === 'boolean',
    'Invalid canonical activity policy',
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
    mode === 'inspect'
      ? null
      : readProtected(options.expectedPath ?? '', 64 * 1024 * 1024);
  if (expected)
    invariant(
      expected.version === 3 && stable(expected.plan) === stable(plan),
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
      await tx`SET LOCAL search_path = pg_catalog, public, pg_temp`;
      const [settings] =
        await tx`SELECT current_setting('transaction_isolation') AS isolation, to_jsonb(now()) AS now`;
      invariant(
        settings.isolation === 'read committed',
        'Reconciliation requires read committed isolation',
      );
      for (const id of [...ids].sort((a, b) => a - b)) {
        const [lock] =
          await tx`SELECT pg_try_advisory_xact_lock(${id}::bigint) AS acquired`;
        invariant(lock.acquired, 'Feed refresh is active');
      }
      const initial =
        await tx`SELECT id, feed_url, itunes_id, podcast_index_id, owner_user_id FROM public.podcasts WHERE id IN (${ids[0]}, ${ids[1]}) ORDER BY id`;
      invariant(initial.length === 2, 'Expected two existing podcasts');
      const initialFeedAliases =
        await tx`SELECT to_jsonb(a) AS data FROM public.podcast_feed_aliases a WHERE podcast_id IN (${ids[0]}, ${ids[1]}) ORDER BY feed_url`;
      const initialAppleAliases =
        await tx`SELECT to_jsonb(a) AS data FROM public.podcast_apple_aliases a WHERE podcast_id IN (${ids[0]}, ${ids[1]}) ORDER BY itunes_id`;
      const claims = [
        ...new Set([
          ...initial.map((row) => `podcast:feed\u001f${row.feed_url}`),
          `podcast:feed\u001f${plan.canonicalFeedUrl}`,
          ...initial
            .filter((row) => row.itunes_id !== null)
            .map((row) => `podcast:itunes\u001f${row.itunes_id}`),
          ...initial
            .filter((row) => row.podcast_index_id !== null)
            .map((row) => `podcast:index\u001f${row.podcast_index_id}`),
          ...initialFeedAliases.map(
            (row) => `podcast:feed\u001f${row.data.feed_url}`,
          ),
          ...initialAppleAliases.map(
            (row) => `podcast:itunes\u001f${row.data.itunes_id}`,
          ),
        ]),
      ].sort();
      for (const claim of claims) {
        const [namespace, value] = claim.split('\u001f');
        const [lock] =
          await tx`SELECT pg_try_advisory_xact_lock(hashtext(${namespace}), hashtext(${value})) AS acquired`;
        invariant(lock.acquired, 'Feed identity import is active');
      }
      const keys = await tx`
        SELECT ns.nspname AS schema, child.relname AS child, parent.relname AS parent,
          c.convalidated, c.condeferrable, c.condeferred, c.confdeltype, c.confupdtype,
          ARRAY(SELECT attname FROM pg_attribute WHERE attrelid=c.conrelid AND attnum=ANY(c.conkey) ORDER BY attnum) AS child_columns,
          ARRAY(SELECT attname FROM pg_attribute WHERE attrelid=c.confrelid AND attnum=ANY(c.confkey) ORDER BY attnum) AS parent_columns
        FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid
        JOIN pg_namespace ns ON ns.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid
        WHERE c.contype='f' AND c.confrelid=ANY(${Object.keys(tables).map((table) => `public.${table}`)}::regclass[])
      `;
      invariant(
        keys.every(
          (row) =>
            row.schema === 'public' &&
            row.convalidated &&
            row.confupdtype === 'a' &&
            (row.child === 'episode_list_items'
              ? row.condeferrable && row.condeferred && row.confdeltype === 'a'
              : !row.condeferrable && row.confdeltype === 'c'),
        ) &&
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
      await verifyReconciliationTriggers(tx, [
        ...Object.keys(tables),
        'episode_list_items',
      ]);
      await tx`LOCK TABLE public.episode_list_items IN SHARE MODE`;
      const saved = await tx`
        SELECT 1 FROM public.episode_list_items i
        JOIN public.episodes e ON e.id = i.episode_id
        WHERE e.podcast_id IN (${ids[0]}, ${ids[1]}) LIMIT 1
      `;
      invariant(
        saved.length === 0,
        'Saved episode memberships require separate reconciliation',
      );
      const conflictingLocator = await tx`
        SELECT 1 FROM public.podcasts WHERE feed_url=${plan.canonicalFeedUrl}
          AND id NOT IN (${ids[0]},${ids[1]})
        UNION ALL
        SELECT 1 FROM public.podcast_feed_aliases WHERE feed_url=${plan.canonicalFeedUrl}
          AND podcast_id NOT IN (${ids[0]},${ids[1]})
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
              String(p.itunes_id) === String(row.itunes_id) &&
              String(p.podcast_index_id) === String(row.podcast_index_id) &&
              p.owner_user_id === row.owner_user_id,
          ),
        ),
        'Source identity changed while acquiring locks',
      );
      invariant(
        sameRows(
          before.podcast_feed_aliases,
          initialFeedAliases.map((row) => row.data),
        ) &&
          sameRows(
            before.podcast_apple_aliases,
            initialAppleAliases.map((row) => row.data),
          ),
        'Accepted aliases changed while acquiring locks',
      );
      const analysis = analyze(before, plan);
      if (mode !== 'inspect') {
        invariant(
          stable(before) === stable(expected.snapshot),
          'Reviewed snapshot changed; inspect again',
        );
        invariant(
          plan.reviewedIdentities === analysis.identitiesDigest,
          'Source identities and alias changes have not been reviewed',
        );
        for (const [needed, supplied, required, message] of [
          [
            analysis.providerRetirements.length > 0,
            plan.reviewedProviderRetirements,
            analysis.providerRetirementsDigest,
            'Provider retirements require exact review',
          ],
          [
            analysis.mediaDifferences.length > 0,
            plan.reviewedMediaDifferences,
            analysis.mediaDifferencesDigest,
            'Shared media differences require exact review',
          ],
          [
            analysis.emptyCanonical !== null,
            plan.reviewedEmptyCanonical,
            analysis.emptyCanonicalDigest,
            'Empty canonical source requires exact review',
          ],
          [
            analysis.catalogChanges,
            plan.reviewedCatalogChanges,
            analysis.catalogChangesDigest,
            'Catalog reference changes require exact review',
          ],
        ] as const)
          invariant(!needed || supplied === required, message);
        invariant(
          plan.reviewedDifferences === analysis.differencesDigest,
          'Metadata differences have not been reviewed',
        );
        invariant(
          analysis.missingMedia.length === 0 ||
            plan.reviewedMissingMedia === analysis.missingMediaDigest,
          'Missing-media cases require separate source-evidence review',
        );
      }
      const artifact = {
        version: 3,
        capturedAt: new Date().toISOString(),
        plan,
        providerRetirements: analysis.providerRetirements,
        providerRetirementsDigest: analysis.providerRetirementsDigest,
        mediaDifferences: analysis.mediaDifferences,
        mediaDifferencesDigest: analysis.mediaDifferencesDigest,
        emptyCanonical: analysis.emptyCanonical,
        emptyCanonicalDigest: analysis.emptyCanonicalDigest,
        catalog: analysis.catalog,
        catalogChanges: analysis.catalogChanges,
        catalogChangesDigest: analysis.catalogChangesDigest,
        snapshot: before,
        identities: analysis.identities,
        identitiesDigest: analysis.identitiesDigest,
        episodeMap: analysis.moves,
        uniqueEpisodeIds: analysis.unique,
        differences: analysis.differences,
        differencesDigest: analysis.differencesDigest,
        missingMedia: analysis.missingMedia,
        missingMediaDigest: analysis.missingMediaDigest,
      };
      writeProtected(options.backupPath, artifact, 64 * 1024 * 1024);
      result = {
        mode,
        identitiesDigest: analysis.identitiesDigest,
        retainedFeedAliases: analysis.identities.feedAliases.length,
        retainedAppleAliases: before.podcast_apple_aliases.length,
        retiredProviderClaims: analysis.providerRetirements.length,
        providerRetirementsDigest: analysis.providerRetirementsDigest,
        mediaDifferences: analysis.mediaDifferences.length,
        mediaDifferencesDigest: analysis.mediaDifferencesDigest,
        emptyCanonical: analysis.emptyCanonical !== null,
        emptyCanonicalDigest: analysis.emptyCanonicalDigest,
        catalogChanges: analysis.catalogChanges,
        catalogChangesDigest: analysis.catalogChangesDigest,
        sharedEpisodes: analysis.moves.length,
        retainedUniqueEpisodes: analysis.unique.length,
        metadataDifferences: analysis.differences.length,
        missingMediaDifferences: analysis.missingMedia.length,
        missingMediaDigest: analysis.missingMediaDigest,
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
      if (analysis.catalogChanges) {
        for (const [table, rows] of Object.entries(analysis.catalog)) {
          await tx.unsafe(
            `DELETE FROM public.${table} WHERE podcast_id IN ($1::bigint,$2::bigint)`,
            ids,
          );
          if (rows.length)
            await tx.unsafe(
              `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table},$1::text::jsonb)`,
              [JSON.stringify(rows)],
            );
        }
      }
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
          is_active=${plan.reactivateCanonical ? true : canonicalBefore.is_active},
          is_essential=${before.podcasts.some((row) => row.is_essential) || before.subscriptions.length > 0 || before.playback_progress.length > 0},
          last_accessed_at=${dates.at(-1) ?? null}, updated_at=now()
        WHERE id=${plan.canonicalId}
      `;
      await tx`DELETE FROM public.podcast_feed_aliases WHERE podcast_id=${plan.canonicalId} AND feed_url=${plan.canonicalFeedUrl}`;
      const expectedFeedAliases = analysis.identities.feedAliases.map(
        (row) => ({ ...row, accepted_at: row.accepted_at ?? settings.now }),
      );
      if (expectedFeedAliases.length)
        await tx`
        INSERT INTO public.podcast_feed_aliases
        SELECT * FROM jsonb_populate_recordset(NULL::public.podcast_feed_aliases, ${tx.json(expectedFeedAliases)}::jsonb)
        ON CONFLICT (feed_url) DO NOTHING
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
            'is_active',
            'is_essential',
            'last_accessed_at',
            'updated_at',
          ]),
        ) ===
          stable(
            without(canonicalBefore, [
              'feed_url',
              'episode_count',
              'is_active',
              'is_essential',
              'last_accessed_at',
              'updated_at',
            ]),
          ),
        'Canonical metadata changed unexpectedly',
      );
      invariant(
        after.podcasts[0].is_active ===
          (plan.reactivateCanonical ? true : canonicalBefore.is_active),
        'Canonical activity policy changed unexpectedly',
      );
      for (const claim of analysis.providerRetirements) {
        const claimed = await tx.unsafe(
          `SELECT 1 FROM public.podcasts WHERE ${claim.field}=$1`,
          [claim.value],
        );
        invariant(
          claimed.length === 0,
          'Retired provider claim was reassigned unexpectedly',
        );
      }
      invariant(
        sameRows(after.podcast_feed_aliases, expectedFeedAliases) &&
          sameRows(after.podcast_apple_aliases, before.podcast_apple_aliases),
        'Accepted alias preservation failed',
      );
      invariant(
        after.podcasts[0].episode_count === expectedEpisodes.length,
        'Episode count postcondition failed',
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
      invariant(
        sameRows(after.transcripts, before.transcripts),
        'Transcript preservation failed',
      );
      for (const [table, rows] of Object.entries(analysis.catalog))
        invariant(
          sameRows(after[table], rows),
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
    const planPath = args.get('--plan');
    const backupPath = args.get('--backup');
    invariant(planPath && backupPath, 'Plan and backup paths are required');
    const plan = readProtected(planPath, 16 * 1024) as ReconciliationPlan;
    sql = openDatabase('RECONCILE_DATABASE_URL');
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

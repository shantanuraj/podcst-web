#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { isCanonicalId } from '../src/shared/canonical-id';
import { DatabaseTargetError, openDatabase } from './lib/database';

export type MergePair = { survivor: string; duplicate: string };
export type MergePlan = { reference: string; pairs: MergePair[] };

export class MergeError extends Error {}

const usage = 'Usage: merge-duplicate-podcasts.ts --plan <plan.json> [--apply]';

export function parseMergeArgs(args: string[]) {
  const apply = args.at(-1) === '--apply';
  const options = apply ? args.slice(0, -1) : args;
  if (options.length !== 2 || options[0] !== '--plan')
    throw new MergeError(usage);
  return { plan: options[1], apply };
}

export function parseMergePlan(value: unknown): MergePlan {
  const plan = value as Partial<MergePlan>;
  if (
    typeof plan?.reference !== 'string' ||
    !/^[\w.:-]{1,200}$/.test(plan.reference) ||
    !Array.isArray(plan.pairs) ||
    plan.pairs.length === 0
  )
    throw new MergeError('A plan needs a reference and at least one pair');
  const survivors = new Set(plan.pairs.map(({ survivor }) => survivor));
  const duplicates = new Set<string>();
  for (const { survivor, duplicate } of plan.pairs) {
    if (!isCanonicalId(survivor) || !isCanonicalId(duplicate))
      throw new MergeError('Pairs need canonical podcast IDs');
    if (
      survivor === duplicate ||
      duplicates.has(duplicate) ||
      survivors.has(duplicate)
    )
      throw new MergeError(
        `Podcast ${duplicate} is merged more than once or also survives`,
      );
    duplicates.add(duplicate);
  }
  return { reference: plan.reference, pairs: plan.pairs };
}

type Source = {
  id: string;
  title: string;
  feed_url: string;
  itunes_id: string | null;
  owner_user_id: string | null;
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export async function mergePair(
  sql: postgres.Sql,
  reference: string,
  { survivor, duplicate }: MergePair,
  apply = false,
) {
  const rolledBack = new Error('Merge dry run');
  let result: Record<string, unknown> | undefined;
  try {
    await sql.begin('ISOLATION LEVEL READ COMMITTED', async (tx) => {
      await tx`SET LOCAL statement_timeout = '30s'`;
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
      const sources = await tx<Source[]>`
        SELECT id::text, title, feed_url, itunes_id::text, owner_user_id
        FROM podcasts WHERE id IN (${survivor}, ${duplicate})
        ORDER BY id FOR UPDATE
      `;
      const keep = sources.find(({ id }) => id === survivor);
      const drop = sources.find(({ id }) => id === duplicate);
      if (!keep || !drop) throw new MergeError('Both podcasts must exist');
      if (keep.owner_user_id || drop.owner_user_id)
        throw new MergeError('Private podcasts cannot be merged');
      const [references] = await tx`
        SELECT
          (SELECT count(*) FROM subscriptions WHERE podcast_id = ${duplicate})::int AS subscriptions,
          (SELECT count(*) FROM playback_progress g JOIN episodes e ON e.id = g.episode_id
            WHERE e.podcast_id = ${duplicate})::int AS playback,
          (SELECT count(*) FROM episode_list_items i JOIN episodes e ON e.id = i.episode_id
            WHERE e.podcast_id = ${duplicate})::int AS list_items
      `;
      if (
        references.subscriptions ||
        references.playback ||
        references.list_items
      )
        throw new MergeError('The duplicate has account references');
      const removed = await tx`
        DELETE FROM episodes d USING episodes s
        WHERE d.podcast_id = ${duplicate} AND s.podcast_id = ${survivor} AND s.guid = d.guid
        RETURNING d.id
      `;
      if (removed.length === 0)
        throw new MergeError('The podcasts share no episode GUIDs');
      const moved = await tx`
        UPDATE episodes SET podcast_id = ${survivor}
        WHERE podcast_id = ${duplicate} RETURNING id
      `;
      const ranks = await tx`
        UPDATE top_podcasts d SET podcast_id = ${survivor}
        WHERE d.podcast_id = ${duplicate} AND NOT EXISTS (
          SELECT 1 FROM top_podcasts s
          WHERE s.podcast_id = ${survivor} AND s.country_id = d.country_id AND s.genre_id = d.genre_id
        )
        RETURNING 1
      `;
      const history = await tx`
        UPDATE chart_history d SET podcast_id = ${survivor}
        WHERE d.podcast_id = ${duplicate} AND NOT EXISTS (
          SELECT 1 FROM chart_history s
          WHERE s.podcast_id = ${survivor} AND s.country_id = d.country_id AND s.day = d.day
        )
        RETURNING 1
      `;
      await tx`
        INSERT INTO podcasts_genres (podcast_id, genre_id)
        SELECT ${survivor}, genre_id FROM podcasts_genres WHERE podcast_id = ${duplicate}
        ON CONFLICT DO NOTHING
      `;
      const feedAliases = (
        await tx<{ feed_url: string }[]>`
          SELECT feed_url FROM podcast_feed_aliases WHERE podcast_id = ${duplicate}
        `
      ).map(({ feed_url }) => feed_url);
      const appleAliases = (
        await tx<{ itunes_id: string }[]>`
          DELETE FROM podcast_apple_aliases WHERE podcast_id = ${duplicate}
          RETURNING itunes_id::text
        `
      ).map(({ itunes_id }) => itunes_id);
      await tx`DELETE FROM podcasts WHERE id = ${duplicate}`;
      const evidence = {
        merge: reference,
        duplicate,
        sharedGuids: removed.length,
      };
      const evidenceReference = `merge:${reference}:${duplicate}`;
      const locators = [drop.feed_url, ...feedAliases].filter(
        (url) => url !== keep.feed_url,
      );
      for (const url of locators)
        await tx`
          INSERT INTO podcast_feed_aliases (feed_url, podcast_id, evidence_type, evidence_reference, evidence)
          VALUES (${url}, ${survivor}, 'reviewed', ${evidenceReference}, ${tx.json(evidence)})
          ON CONFLICT (feed_url) DO NOTHING
        `;
      let itunesId = keep.itunes_id;
      if (!itunesId && drop.itunes_id) {
        itunesId = drop.itunes_id;
        await tx`UPDATE podcasts SET itunes_id = ${itunesId} WHERE id = ${survivor}`;
      } else if (drop.itunes_id && drop.itunes_id !== itunesId)
        appleAliases.push(drop.itunes_id);
      if (appleAliases.length && !itunesId)
        throw new MergeError('Apple aliases need a preferred Apple listing');
      for (const alias of appleAliases)
        await tx`
          INSERT INTO podcast_apple_aliases (itunes_id, podcast_id, evidence_type, evidence_reference, evidence)
          VALUES (${alias}, ${survivor}, 'reviewed', ${evidenceReference}, ${tx.json(evidence)})
        `;
      const [after] = await tx`
        UPDATE podcasts p SET
          episode_count = e.count,
          last_published = greatest(p.last_published, e.last),
          updated_at = now()
        FROM (
          SELECT count(*)::int AS count, max(published) AS last
          FROM episodes WHERE podcast_id = ${survivor}
        ) e
        WHERE p.id = ${survivor}
        RETURNING p.episode_count, p.itunes_id::text
      `;
      result = {
        status: apply ? 'committed' : 'rolled_back',
        survivor: { id: survivor, title: keep.title },
        duplicate: {
          id: duplicate,
          title: drop.title,
          itunesId: drop.itunes_id,
          feedSha256: digest(drop.feed_url),
        },
        sharedEpisodesRemoved: removed.length,
        episodesMoved: moved.length,
        chartRanksMoved: ranks.length,
        chartHistoryMoved: history.length,
        feedAliasesAdded: locators.length,
        appleAliasesAdded: appleAliases.length,
        survivorAfter: after,
      };
      if (!apply) throw rolledBack;
    });
  } catch (error) {
    if (error === rolledBack) return result;
    throw error;
  }
  return result;
}

export async function main(args: string[]) {
  const options = parseMergeArgs(args);
  const plan = parseMergePlan(await Bun.file(options.plan).json());
  const sql = openDatabase('MERGE_DATABASE_URL');
  let failed = 0;
  try {
    for (const pair of plan.pairs) {
      try {
        console.log(
          JSON.stringify(
            await mergePair(sql, plan.reference, pair, options.apply),
          ),
        );
      } catch (error) {
        failed++;
        console.log(
          JSON.stringify({
            status: 'refused',
            ...pair,
            reason:
              error instanceof MergeError
                ? error.message
                : error instanceof postgres.PostgresError
                  ? `${error.code} ${error.message}`
                  : 'unexpected error',
          }),
        );
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof MergeError || error instanceof DatabaseTargetError
        ? error.message
        : 'Merge failed; inspect both podcasts before retrying',
    );
    process.exitCode = 1;
  });
}

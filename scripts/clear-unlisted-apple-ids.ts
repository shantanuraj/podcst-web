#!/usr/bin/env bun

import postgres from 'postgres';
import { ITUNES_API } from '../src/data/constants';
import { isCanonicalId, migrateStoredId } from '../src/shared/canonical-id';
import { DatabaseTargetError, openDatabase } from './lib/database';

export class UnlistedAppleIdError extends Error {}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type AppleClaim = {
  podcastId: string;
  itunesId: string;
  preferred: boolean;
};

const LOOKUP_BATCH = 150;

const usage =
  'Usage: clear-unlisted-apple-ids.ts [--ids <podcast-ids.json>] [--apply]';

export function parseUnlistedArgs(args: string[]) {
  const apply = args.at(-1) === '--apply';
  const options = apply ? args.slice(0, -1) : args;
  if (options.length === 0) return { ids: null, apply };
  if (options.length === 2 && options[0] === '--ids')
    return { ids: options[1], apply };
  throw new UnlistedAppleIdError(usage);
}

export async function servedAppleClaims(
  sql: postgres.Sql,
  extra: string[] = [],
): Promise<AppleClaim[]> {
  if (extra.some((id) => !isCanonicalId(id)))
    throw new UnlistedAppleIdError('Podcast IDs must be canonical');
  const rows = await sql<
    { podcast_id: string; itunes_id: string; preferred: boolean }[]
  >`
    WITH served AS MATERIALIZED (
      SELECT id FROM podcasts WHERE is_essential
      UNION SELECT podcast_id FROM subscriptions
      UNION SELECT unnest(${extra}::bigint[])
    )
    SELECT p.id::text AS podcast_id, p.itunes_id::text, true AS preferred
    FROM served JOIN podcasts p ON p.id = served.id
    WHERE p.itunes_id IS NOT NULL AND p.owner_user_id IS NULL
    UNION ALL
    SELECT a.podcast_id::text, a.itunes_id::text, false
    FROM served JOIN podcast_apple_aliases a ON a.podcast_id = served.id
    ORDER BY 1, 3 DESC, 2
  `;
  return rows.map((row) => ({
    podcastId: row.podcast_id,
    itunesId: row.itunes_id,
    preferred: row.preferred,
  }));
}

export async function findUnlisted(
  itunesIds: string[],
  storefronts: string[],
  request: Fetch = fetch,
  pause = () => Bun.sleep(3000),
) {
  let missing = [...new Set(itunesIds)];
  let requests = 0;
  const skipped: string[] = [];
  for (const country of storefronts) {
    if (missing.length === 0) break;
    const found = new Set<string>();
    for (let start = 0; start < missing.length; start += LOOKUP_BATCH) {
      if (requests++) await pause();
      const url = new URL('/lookup', ITUNES_API);
      url.search = new URLSearchParams({
        id: missing.slice(start, start + LOOKUP_BATCH).join(','),
        entity: 'podcast',
        country,
      }).toString();
      const response = await request(url.href, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      if (response.status === 400) {
        skipped.push(country);
        break;
      }
      if (!response.ok)
        throw new UnlistedAppleIdError(
          `Apple lookup failed with HTTP ${response.status} for ${country}`,
        );
      const data = (await response.json()) as { results?: unknown };
      if (!Array.isArray(data.results))
        throw new UnlistedAppleIdError('Apple returned an invalid lookup');
      for (const result of data.results) {
        const row = result as { kind?: unknown; collectionId?: unknown };
        const identity = migrateStoredId(row.collectionId);
        if (row.kind === 'podcast' && 'canonicalId' in identity)
          found.add(identity.canonicalId);
      }
    }
    missing = missing.filter((id) => !found.has(id));
  }
  return { unlisted: new Set(missing), requests, skipped };
}

export async function clearUnlisted(
  sql: postgres.Sql,
  podcastId: string,
  unlisted: Set<string>,
  apply = false,
) {
  const rolledBack = new Error('Unlisted Apple ID dry run');
  let result: Record<string, unknown> | undefined;
  try {
    await sql.begin('ISOLATION LEVEL READ COMMITTED', async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`;
      await tx`SET LOCAL lock_timeout = '3s'`;
      const [podcast] = await tx<{ title: string; itunes_id: string | null }[]>`
        SELECT title, itunes_id::text FROM podcasts
        WHERE id = ${podcastId} AND owner_user_id IS NULL FOR UPDATE
      `;
      if (!podcast) return;
      const aliases = (
        await tx<{ itunes_id: string }[]>`
          SELECT itunes_id::text FROM podcast_apple_aliases
          WHERE podcast_id = ${podcastId} ORDER BY accepted_at, itunes_id
        `
      ).map(({ itunes_id }) => itunes_id);
      const deadAliases = aliases.filter((id) => unlisted.has(id));
      const liveAliases = aliases.filter((id) => !unlisted.has(id));
      const preferredDead =
        podcast.itunes_id !== null && unlisted.has(podcast.itunes_id);
      if (!preferredDead && deadAliases.length === 0) return;
      const promoted = preferredDead ? (liveAliases[0] ?? null) : null;
      const removed = [
        ...(preferredDead ? [podcast.itunes_id as string] : []),
        ...deadAliases,
      ];
      const dropped = [...deadAliases, ...(promoted ? [promoted] : [])];
      if (dropped.length)
        await tx`
          DELETE FROM podcast_apple_aliases
          WHERE podcast_id = ${podcastId} AND itunes_id IN ${tx(dropped)}
        `;
      if (preferredDead)
        await tx`
          UPDATE podcasts SET itunes_id = ${promoted}, updated_at = now()
          WHERE id = ${podcastId}
        `;
      await tx`
        INSERT INTO unlisted_apple_ids ${tx(removed.map((itunes_id) => ({ itunes_id })))}
        ON CONFLICT (itunes_id) DO UPDATE SET checked_at = now()
      `;
      result = {
        status: apply ? 'committed' : 'rolled_back',
        podcast: { id: podcastId, title: podcast.title },
        removed,
        preferred: preferredDead
          ? { from: podcast.itunes_id, to: promoted }
          : null,
      };
      if (!apply) throw rolledBack;
    });
  } catch (error) {
    if (error === rolledBack) return result;
    throw error;
  }
  return result;
}

export async function recordAppleIdMetrics(
  sql: postgres.Sql,
  metrics: Record<string, number>,
) {
  await sql`
    INSERT INTO poll_metrics ${sql(
      Object.entries(metrics).map(([name, value]) => ({
        metric_name: `apple_ids_${name}`,
        metric_value: value,
      })),
    )}
  `;
}

export async function main(args: string[]) {
  const options = parseUnlistedArgs(args);
  const extra = options.ids
    ? ((await Bun.file(options.ids).json()) as string[])
    : [];
  const sql = openDatabase('APPLE_IDS_DATABASE_URL');
  try {
    const claims = await servedAppleClaims(sql, extra);
    const storefronts = (
      await sql<{ id: string }[]>`
        SELECT id FROM countries ORDER BY id = 'us' DESC, id
      `
    ).map(({ id }) => id);
    const { unlisted, requests, skipped } = await findUnlisted(
      claims.map(({ itunesId }) => itunesId),
      storefronts,
    );
    const listed = [...new Set(claims.map(({ itunesId }) => itunesId))].filter(
      (id) => !unlisted.has(id),
    );
    const relisted =
      options.apply && listed.length
        ? (
            await sql`
              DELETE FROM unlisted_apple_ids WHERE itunes_id IN ${sql(listed)}
              RETURNING itunes_id
            `
          ).length
        : 0;
    let promoted = 0;
    let cleared = 0;
    const podcasts = [
      ...new Set(
        claims
          .filter(({ itunesId }) => unlisted.has(itunesId))
          .map(({ podcastId }) => podcastId),
      ),
    ];
    for (const podcastId of podcasts) {
      const result = await clearUnlisted(
        sql,
        podcastId,
        unlisted,
        options.apply,
      );
      if (!result) continue;
      console.log(JSON.stringify(result));
      const preferred = result.preferred as { to: string | null } | null;
      if (preferred?.to) promoted++;
      else if (preferred) cleared++;
    }
    if (options.apply)
      await recordAppleIdMetrics(sql, {
        checked: new Set(claims.map(({ itunesId }) => itunesId)).size,
        unlisted: unlisted.size,
        relisted,
        promoted,
        cleared,
        storefronts_skipped: skipped.length,
      });
    console.log(
      JSON.stringify({
        status: 'summary',
        apply: options.apply,
        checked: claims.length,
        unlisted: unlisted.size,
        podcasts: podcasts.length,
        lookups: requests,
        skippedStorefronts: skipped,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof UnlistedAppleIdError ||
        error instanceof DatabaseTargetError
        ? error.message
        : error instanceof postgres.PostgresError
          ? `${error.code} ${error.message}`
          : 'Unlisted Apple ID check failed; nothing after the failure was changed',
    );
    process.exitCode = 1;
  });
}

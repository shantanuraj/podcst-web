import type postgres from 'postgres';
import { FEED_LIMITS } from '@/shared/feed-contract';
import { authSecret } from '../auth/backend';
import { trustedAuthSource } from '../auth/limits';
import { createRedis } from '../redis';
import { readGeneration } from '../state/generation';
import { createFeedAdmission } from './feed-admission';
import { FeedAdmissionError } from './feed-demand';
import { indexPrivatePodcast } from './index-podcast';
import { resolvePodcast } from './resolve-podcast';

let redis: ReturnType<typeof createRedis> | undefined;
let connecting: Promise<void> | undefined;

export async function interactiveAdmission() {
  try {
    redis ??= createRedis({
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    if (redis.listenerCount('error') === 0) redis.on('error', () => {});
    if (redis.status !== 'ready') {
      connecting ??= redis.connect().finally(() => {
        connecting = undefined;
      });
      await connecting;
    }
    return createFeedAdmission(redis, authSecret());
  } catch {
    throw new FeedAdmissionError('unavailable');
  }
}

export function feedPrincipal(headers: Headers) {
  return {
    kind: 'source' as const,
    id: trustedAuthSource(
      { headers } as Request,
      process.env.AUTH_TRUSTED_IP_HEADER,
    ),
  };
}

export function privateImportAdmission(accountId: string) {
  return importAdmission({ kind: 'account', id: accountId });
}

function importAdmission(principal: {
  kind: 'account' | 'source';
  id: string;
}) {
  let admitted:
    | Promise<Awaited<ReturnType<typeof interactiveAdmission>>>
    | undefined;
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    admitted ??= interactiveAdmission().then(async (limits) => {
      await limits.importRequest(principal);
      return limits;
    });
    return (await admitted).importLease(principal, signal);
  };
}

export async function importPrivateFeed(
  sql: postgres.Sql,
  url: string,
  session: { id: string; userId: string },
  signal?: AbortSignal,
) {
  const { scope } = await readGeneration(sql, session.userId);
  return indexPrivatePodcast(sql, url, session.userId, signal, {
    ...scope,
    sessionId: session.id,
    admit: privateImportAdmission(session.userId),
  });
}

export async function resolveInteractivePodcast(
  sql: postgres.Sql,
  itunesId: string,
  locale: string | undefined,
  headers: Headers,
  callerSignal?: AbortSignal,
) {
  const rows = await sql<{ id: string }[]>`
    SELECT p.id FROM podcasts p WHERE p.owner_user_id IS NULL AND
      (p.itunes_id = ${itunesId} OR EXISTS (SELECT 1 FROM podcast_apple_aliases a WHERE a.podcast_id = p.id AND a.itunes_id = ${itunesId}))
  `;
  if (rows.length === 1) return rows[0].id;
  if (rows.length > 1) throw new FeedAdmissionError('unavailable');
  const deadline = AbortSignal.timeout(FEED_LIMITS.imports.deadlineMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline])
    : deadline;
  const lease = await importAdmission(feedPrincipal(headers))(signal);
  try {
    return await resolvePodcast(sql, itunesId, locale, fetch, {
      signal: lease.signal,
      beforeCommit: () => lease.assertOwned(),
    });
  } finally {
    await lease.release().catch(() => {});
  }
}

import type postgres from 'postgres';
import { FEED_LIMITS } from '@/shared/feed-contract';
import { readGeneration } from '../state/generation';
import {
  claimAppleIdentity,
  findAppleSource,
  prepareAppleIdentity,
} from './apple-identity';
import { upsertEpisodes } from './episodes';
import { claimPublicAliases } from './feed-aliases';
import { fetchFeed, savePollState } from './feed-refresh';
import { getPollInterval } from './feed-schedule';
import { assertImportScope } from './import-scope';
import {
  type AppleListingVerification,
  claimPublicIdentity,
  findPodcastIdentity,
  lockPodcastIdentities,
  PodcastAccessDenied,
  type PodcastIdentity,
  PodcastIdentityBusy,
  PodcastIdentityConflict,
} from './podcast-identity';
import { verifyPublicFeedMove } from './public-feed-moves';

export {
  claimPublicIdentity,
  findPodcastIdentity,
  lockPodcastIdentities,
  PodcastAccessDenied,
  type PodcastIdentity,
  PodcastIdentityConflict,
} from './podcast-identity';

export interface ImportLease {
  signal: AbortSignal;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

export interface PrivateImportScope {
  generation: string;
  sessionId?: string;
  admit?: (signal: AbortSignal) => Promise<ImportLease>;
}

interface ImportAdmission {
  beforeFetch(signal: AbortSignal): Promise<AbortSignal>;
  beforeCommit(): Promise<void>;
}

function authorizePrivate(podcast: PodcastIdentity, userId: string) {
  if (podcast.owner_user_id !== null && podcast.owner_user_id !== userId) {
    throw new PodcastAccessDenied('Feed unavailable');
  }
  return String(podcast.id);
}

async function index(
  sql: postgres.Sql,
  feedUrl: string,
  ownerUserId: string | null,
  itunesId?: string,
  verifyMove = verifyPublicFeedMove,
  verification?: AppleListingVerification,
  signal?: AbortSignal,
  scope?: PrivateImportScope,
  admission?: ImportAdmission,
): Promise<string> {
  signal?.throwIfAborted();
  const applePlan =
    verification && itunesId !== undefined
      ? await prepareAppleIdentity(sql, { ...verification, itunesId, feedUrl })
      : null;
  const existing = applePlan
    ? await findAppleSource(sql, applePlan.listing)
    : await findPodcastIdentity(sql, feedUrl, itunesId);
  if (existing && ownerUserId) authorizePrivate(existing, ownerUserId);
  if (!ownerUserId && existing?.owner_user_id && itunesId === undefined)
    throw new PodcastAccessDenied('Feed unavailable');
  if (!existing && admission && signal)
    signal = await admission.beforeFetch(signal);
  signal?.throwIfAborted();
  const fetched = existing
    ? null
    : await fetchFeed(feedUrl, undefined, ownerUserId !== null, signal);
  if (fetched && fetched.status !== 'updated')
    throw new Error('Feed was not returned');
  const moveVerification =
    !ownerUserId && fetched?.publicRedirect ? await verifyMove(feedUrl) : null;
  const move =
    moveVerification?.status === 'verified' ? moveVerification.evidence : null;
  if (move && move.requestedUrl !== feedUrl)
    throw new PodcastIdentityConflict(
      'Move evidence identifies another source',
    );
  const requestedLocators = [
    ...new Set([
      feedUrl,
      ...(move?.aliases ?? []),
      ...(move ? [move.canonicalFeedUrl] : []),
    ]),
  ];
  const observations = move
    ? await Promise.all(
        requestedLocators.map((locator) =>
          findPodcastIdentity(sql, locator, applePlan ? undefined : itunesId),
        ),
      )
    : [existing];
  const locators = [
    ...new Set([
      ...requestedLocators,
      ...observations.flatMap((source) => (source ? [source.feed_url] : [])),
    ]),
  ];

  const identities = [
    ...locators.map((feedUrl) => ({ feedUrl, itunesId })),
    ...(applePlan?.identities ?? []),
  ];
  const claim = (tx: postgres.TransactionSql, source: PodcastIdentity) =>
    applePlan
      ? claimAppleIdentity(tx, source, applePlan, identities)
      : claimPublicIdentity(tx, source, feedUrl, itunesId, verification);

  await admission?.beforeCommit();
  signal?.throwIfAborted();
  return sql.begin(async (tx) => {
    if (signal) {
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL statement_timeout = '10s'`;
    }
    signal?.throwIfAborted();
    if (ownerUserId && scope)
      await assertImportScope(tx, ownerUserId, scope, true);
    await lockPodcastIdentities(tx, identities);
    signal?.throwIfAborted();
    let found: PodcastIdentity | undefined;
    for (const locator of locators) {
      const match = await findPodcastIdentity(
        tx,
        locator,
        applePlan ? undefined : itunesId,
        undefined,
        true,
      );
      if (found && match && String(found.id) !== String(match.id))
        throw new PodcastIdentityConflict(
          'Move identifies different existing sources',
        );
      found ??= match;
    }
    if (found) {
      if (!locators.includes(found.feed_url))
        throw new PodcastIdentityBusy(
          'Canonical source changed during import; retry',
        );
      signal?.throwIfAborted();
      if (ownerUserId) return authorizePrivate(found, ownerUserId);
      if (move) {
        await claimPublicAliases(tx, {
          podcastId: String(found.id),
          expectedFeedUrl: found.feed_url,
          aliases: locators,
          evidence: {
            type: 'permanent_redirect',
            reference: move.reference,
            details: move.details,
          },
        });
      }
      return claim(tx, found);
    }
    if (fetched?.status !== 'updated')
      throw new Error('Feed changed during import; retry');
    const { data } = fetched;
    const authorName = data.author || 'Unknown';
    let [author] =
      await tx`SELECT id FROM authors WHERE name = ${authorName} LIMIT 1`;
    if (!author)
      [author] =
        await tx`INSERT INTO authors (name) VALUES (${authorName}) RETURNING id`;
    const [podcast] = await tx<PodcastIdentity[]>`
      INSERT INTO podcasts (
        itunes_id, owner_user_id, feed_url, title, author_id, description, cover,
        website_url, explicit, episode_count, last_published
      ) VALUES (
        ${applePlan ? null : (itunesId ?? null)}, ${ownerUserId}, ${move?.canonicalFeedUrl ?? feedUrl}, ${data.title}, ${author.id},
        ${data.description}, ${data.cover}, ${data.link}, ${data.explicit},
        ${data.episodes.length}, ${data.published ? new Date(data.published) : null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, itunes_id, podcast_index_id, feed_url, owner_user_id
    `;
    if (!podcast) {
      const winner = await findPodcastIdentity(
        tx,
        feedUrl,
        applePlan ? undefined : itunesId,
        undefined,
        true,
      );
      if (!winner)
        throw new PodcastIdentityConflict('Unable to resolve podcast identity');
      signal?.throwIfAborted();
      return ownerUserId
        ? authorizePrivate(winner, ownerUserId)
        : claim(tx, winner);
    }
    const id = String(podcast.id);
    if (move)
      await claimPublicAliases(tx, {
        podcastId: id,
        expectedFeedUrl: podcast.feed_url,
        aliases: locators,
        evidence: {
          type: 'permanent_redirect',
          reference: move.reference,
          details: move.details,
        },
      });
    if (applePlan) await claim(tx, podcast);
    await upsertEpisodes(tx, id, data.cover, data.episodes);
    await savePollState(tx, id, fetched, getPollInterval(null));
    signal?.throwIfAborted();
    return id;
  });
}

export function indexPodcast(
  sql: postgres.Sql,
  feedUrl: string,
  itunesId?: string,
  verifyMove = verifyPublicFeedMove,
  verification?: AppleListingVerification,
) {
  return index(sql, feedUrl, null, itunesId, verifyMove, verification);
}

export async function indexPrivatePodcast(
  sql: postgres.Sql,
  feedUrl: string,
  userId: string,
  callerSignal?: AbortSignal,
  scope?: PrivateImportScope,
) {
  if (!userId) throw new PodcastAccessDenied('Sign in to import a feed');
  const deadline = AbortSignal.timeout(FEED_LIMITS.imports.deadlineMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline])
    : deadline;
  signal.throwIfAborted();
  const expected = scope ?? (await readGeneration(sql, userId)).scope;
  let lease: ImportLease | undefined;
  try {
    return await index(
      sql,
      feedUrl,
      userId,
      undefined,
      undefined,
      undefined,
      signal,
      expected,
      {
        async beforeFetch(signal) {
          lease = await scope?.admit?.(signal);
          return lease ? AbortSignal.any([signal, lease.signal]) : signal;
        },
        async beforeCommit() {
          await lease?.assertOwned();
        },
      },
    );
  } finally {
    if (lease) await lease.release().catch(() => {});
  }
}

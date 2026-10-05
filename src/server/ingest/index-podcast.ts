import type postgres from 'postgres';
import {
  claimAppleIdentity,
  findAppleSource,
  prepareAppleIdentity,
} from './apple-identity';
import { upsertEpisodes } from './episodes';
import { claimPublicAliases } from './feed-aliases';
import { fetchFeed, savePollState } from './feed-refresh';
import { getPollInterval } from './feed-schedule';
import {
  type AppleListingVerification,
  claimPublicIdentity,
  findPodcastIdentity,
  lockPodcastIdentities,
  PodcastAccessDenied,
  type PodcastIdentity,
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

function authorizePrivate(podcast: PodcastIdentity, userId: string) {
  if (podcast.owner_user_id !== null && podcast.owner_user_id !== userId) {
    throw new PodcastAccessDenied('Feed unavailable');
  }
  return Number(podcast.id);
}

async function index(
  sql: postgres.Sql,
  feedUrl: string,
  ownerUserId: string | null,
  itunesId?: number,
  verifyMove = verifyPublicFeedMove,
  verification?: AppleListingVerification,
): Promise<number> {
  const applePlan =
    verification && itunesId !== undefined
      ? await prepareAppleIdentity(sql, { ...verification, itunesId, feedUrl })
      : null;
  const existing = applePlan
    ? await findAppleSource(sql, applePlan.listing)
    : await findPodcastIdentity(sql, feedUrl, itunesId);
  if (existing && ownerUserId) return authorizePrivate(existing, ownerUserId);
  if (existing?.owner_user_id && itunesId === undefined)
    throw new PodcastAccessDenied('Feed unavailable');
  const fetched = existing
    ? null
    : await fetchFeed(feedUrl, undefined, ownerUserId !== null);
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

  return sql.begin(async (tx) => {
    await lockPodcastIdentities(tx, identities);
    let found: PodcastIdentity | undefined;
    for (const locator of locators) {
      const match = await findPodcastIdentity(
        tx,
        locator,
        applePlan ? undefined : itunesId,
        undefined,
        true,
      );
      if (found && match && Number(found.id) !== Number(match.id))
        throw new PodcastIdentityConflict(
          'Move identifies different existing sources',
        );
      found ??= match;
    }
    if (found) {
      if (!locators.includes(found.feed_url))
        throw new PodcastIdentityConflict(
          'Canonical source changed during import; retry',
        );
      if (ownerUserId) return authorizePrivate(found, ownerUserId);
      if (move) {
        await claimPublicAliases(tx, {
          podcastId: Number(found.id),
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
      return ownerUserId
        ? authorizePrivate(winner, ownerUserId)
        : claim(tx, winner);
    }
    const id = Number(podcast.id);
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
    return id;
  });
}

export function indexPodcast(
  sql: postgres.Sql,
  feedUrl: string,
  itunesId?: number,
  verifyMove = verifyPublicFeedMove,
  verification?: AppleListingVerification,
) {
  return index(sql, feedUrl, null, itunesId, verifyMove, verification);
}

export function indexPrivatePodcast(
  sql: postgres.Sql,
  feedUrl: string,
  userId: string,
) {
  if (!userId) throw new PodcastAccessDenied('Sign in to import a feed');
  return index(sql, feedUrl, userId);
}

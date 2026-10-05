import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { type AppleListing, assertFreshAppleListing } from './apple-listing';
import {
  claimPublicIdentity,
  findPodcastIdentities,
  findPodcastIdentity,
  type PodcastIdentity,
  PodcastIdentityConflict,
} from './podcast-identity';

type Claim = { feedUrl: string; itunesId?: number };

export interface AppleIdentityPlan {
  listing: AppleListing;
  identities: Claim[];
  previousSourceId: number | null;
}

export async function prepareAppleIdentity(
  sql: postgres.ISql,
  listing: AppleListing,
): Promise<AppleIdentityPlan> {
  const sources = await findPodcastIdentities(
    sql,
    listing.feedUrl,
    listing.itunesId,
  );
  const aliases = await sql<{ itunes_id: string; podcast_id: string }[]>`
    SELECT itunes_id, podcast_id FROM podcast_apple_aliases
    WHERE podcast_id = ANY(${sources.map(({ id }) => Number(id))}::bigint[])
    ORDER BY itunes_id
  `;
  const owners = new Set([
    ...sources
      .filter((p) => Number(p.itunes_id) === listing.itunesId)
      .map((p) => Number(p.id)),
    ...aliases
      .filter((a) => Number(a.itunes_id) === listing.itunesId)
      .map((a) => Number(a.podcast_id)),
  ]);
  if (owners.size > 1)
    throw new PodcastIdentityConflict(
      'Apple identity identifies multiple sources',
    );
  const identities: Claim[] = [
    { feedUrl: listing.feedUrl, itunesId: listing.itunesId },
  ];
  for (const source of sources) {
    identities.push({
      feedUrl: source.feed_url,
      itunesId:
        source.itunes_id === null ? undefined : Number(source.itunes_id),
    });
    for (const alias of aliases.filter(
      (a) => Number(a.podcast_id) === Number(source.id),
    ))
      identities.push({
        feedUrl: source.feed_url,
        itunesId: Number(alias.itunes_id),
      });
  }
  return {
    listing,
    identities,
    previousSourceId: owners.values().next().value ?? null,
  };
}

export async function findAppleSource(
  sql: postgres.ISql,
  listing: AppleListing,
  forUpdate = false,
) {
  assertFreshAppleListing(listing);
  return findPodcastIdentity(
    sql,
    listing.feedUrl,
    undefined,
    undefined,
    forUpdate,
  );
}

function keys(identities: Claim[]) {
  return new Set(
    identities.flatMap(({ feedUrl, itunesId }) => [
      `feed:${feedUrl}`,
      ...(itunesId === undefined ? [] : [`itunes:${itunesId}`]),
    ]),
  );
}

export async function claimAppleIdentity(
  tx: postgres.TransactionSql,
  source: PodcastIdentity,
  plan: AppleIdentityPlan,
  lockedIdentities = plan.identities,
): Promise<number> {
  const { listing } = plan;
  assertFreshAppleListing(listing);
  const matches = await findPodcastIdentities(
    tx,
    listing.feedUrl,
    listing.itunesId,
    undefined,
    true,
  );
  const target = await findAppleSource(tx, listing, true);
  if (!target || Number(target.id) !== Number(source.id))
    throw new PodcastIdentityConflict(
      'Verified listing does not identify this source',
    );
  const current = await prepareAppleIdentity(tx, listing);
  if (
    current.previousSourceId !== plan.previousSourceId &&
    current.previousSourceId !== Number(target.id)
  )
    throw new PodcastIdentityConflict(
      'Apple association changed during verification; retry',
    );
  const locked = keys(lockedIdentities);
  if ([...keys(current.identities)].some((key) => !locked.has(key)))
    throw new PodcastIdentityConflict('Apple identity lock set changed; retry');
  const previous = matches.find(
    (p) => Number(p.id) === current.previousSourceId,
  );
  if (previous && Number(previous.id) !== Number(target.id)) {
    if (previous.owner_user_id !== null || target.owner_user_id !== null)
      throw new PodcastIdentityConflict(
        'Apple reassignment requires public sources',
      );
    if (Number(previous.itunes_id) === listing.itunesId) {
      const [replacement] = await tx`
        SELECT itunes_id FROM podcast_apple_aliases
        WHERE podcast_id = ${previous.id} ORDER BY itunes_id LIMIT 1
      `;
      if (replacement)
        await tx`DELETE FROM podcast_apple_aliases WHERE itunes_id = ${replacement.itunes_id} AND podcast_id = ${previous.id}`;
      await tx`
        UPDATE podcasts SET itunes_id = ${replacement?.itunes_id ?? null}, updated_at = now()
        WHERE id = ${previous.id} AND itunes_id = ${listing.itunesId} AND owner_user_id IS NULL
      `;
    } else {
      await tx`DELETE FROM podcast_apple_aliases WHERE itunes_id = ${listing.itunesId} AND podcast_id = ${previous.id}`;
    }
  }
  const id = await claimPublicIdentity(
    tx,
    target,
    listing.feedUrl,
    listing.itunesId,
    listing,
  );
  if (previous && Number(previous.id) !== id)
    console.info(
      JSON.stringify({
        event: 'apple_association_staged',
        itunesId: listing.itunesId,
        from: Number(previous.id),
        to: id,
        country: listing.country,
        verifiedAt: listing.verifiedAt,
        evidence: createHash('sha256')
          .update(JSON.stringify(listing))
          .digest('hex'),
      }),
    );
  return id;
}

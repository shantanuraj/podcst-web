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

type Claim = { feedUrl: string; itunesId?: string };

const evidenceReference = (evidence: object) =>
  createHash('sha256').update(JSON.stringify(evidence)).digest('hex');

const titleKey = (title: string) =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

export interface AppleIdentityPlan {
  listing: AppleListing;
  identities: Claim[];
  previousSourceId: string | null;
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
    WHERE podcast_id = ANY(${sources.map(({ id }) => id)}::bigint[])
    ORDER BY itunes_id
  `;
  const owners = new Set([
    ...sources
      .filter((p) => String(p.itunes_id) === listing.itunesId)
      .map((p) => p.id),
    ...aliases
      .filter((a) => a.itunes_id === listing.itunesId)
      .map((a) => a.podcast_id),
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
        source.itunes_id === null ? undefined : String(source.itunes_id),
    });
    for (const alias of aliases.filter((a) => a.podcast_id === source.id))
      identities.push({
        feedUrl: source.feed_url,
        itunesId: alias.itunes_id,
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

export async function adoptAppleFeed(
  tx: postgres.TransactionSql,
  plan: AppleIdentityPlan,
  title: string,
): Promise<PodcastIdentity | undefined> {
  const { listing, previousSourceId } = plan;
  assertFreshAppleListing(listing);
  if (previousSourceId === null) return undefined;
  const [holder] = await tx<{ title: string }[]>`
    SELECT title FROM podcasts
    WHERE id = ${previousSourceId} AND owner_user_id IS NULL
    FOR UPDATE
  `;
  const key = titleKey(title);
  if (!holder || !key || titleKey(holder.title) !== key) return undefined;
  const proof = { ...listing, title };
  const { feedUrl, ...evidence } = proof;
  const reference = evidenceReference(proof);
  await tx`
    INSERT INTO podcast_feed_aliases (feed_url, podcast_id, evidence_type, evidence_reference, evidence)
    VALUES (${feedUrl}, ${previousSourceId}, 'apple_lookup', ${reference}, ${tx.json(evidence)})
    ON CONFLICT (feed_url) DO NOTHING
  `;
  console.info(
    JSON.stringify({
      event: 'apple_feed_adopted',
      itunesId: listing.itunesId,
      podcastId: previousSourceId,
      country: listing.country,
      verifiedAt: listing.verifiedAt,
      evidence: reference,
    }),
  );
  return findAppleSource(tx, listing, true);
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
): Promise<string> {
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
  if (!target || target.id !== source.id)
    throw new PodcastIdentityConflict(
      'Verified listing does not identify this source',
    );
  const current = await prepareAppleIdentity(tx, listing);
  if (
    current.previousSourceId !== plan.previousSourceId &&
    current.previousSourceId !== target.id
  )
    throw new PodcastIdentityConflict(
      'Apple association changed during verification; retry',
    );
  const locked = keys(lockedIdentities);
  if ([...keys(current.identities)].some((key) => !locked.has(key)))
    throw new PodcastIdentityConflict('Apple identity lock set changed; retry');
  const previous = matches.find((p) => p.id === current.previousSourceId);
  if (previous && previous.id !== target.id) {
    if (previous.owner_user_id !== null || target.owner_user_id !== null)
      throw new PodcastIdentityConflict(
        'Apple reassignment requires public sources',
      );
    if (String(previous.itunes_id) === listing.itunesId) {
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
  if (previous && previous.id !== id)
    console.info(
      JSON.stringify({
        event: 'apple_association_staged',
        itunesId: listing.itunesId,
        from: previous.id,
        to: id,
        country: listing.country,
        verifiedAt: listing.verifiedAt,
        evidence: evidenceReference(listing),
      }),
    );
  return id;
}

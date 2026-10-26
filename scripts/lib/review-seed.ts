import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import manifest from '../../contracts/review/seed.json';
import { writePreferences } from '../../src/server/account';
import { buildRows, upsertEpisodes } from '../../src/server/ingest/episodes';
import {
  type fetchFeed,
  savePollState,
} from '../../src/server/ingest/feed-refresh';
import { getPollInterval } from '../../src/server/ingest/feed-schedule';
import { insertPodcast } from '../../src/server/ingest/index-podcast';
import {
  findPodcastIdentity,
  lockPodcastIdentities,
} from '../../src/server/ingest/podcast-identity';
import {
  changeEpisodeList,
  insertEpisodeList,
} from '../../src/server/lists/service';
import { changeFollowState } from '../../src/server/state/follows';
import { readGeneration } from '../../src/server/state/generation';
import { changeProgressState } from '../../src/server/state/progress';
import { defaultPreferences } from '../../src/shared/preferences';
import { reviewEpisodeGuid } from '../../src/shared/review-sampler';
import { digest } from './artifacts';
import { ReviewAccountError } from './review-account-state';

export interface ResolvedReviewSeed {
  revision: string;
  feeds: {
    key: 'public' | 'private';
    url: string;
    fetched: Extract<
      Awaited<ReturnType<typeof fetchFeed>>,
      { status: 'updated' }
    >;
  }[];
}

export function validateReviewSeed(seed: ResolvedReviewSeed) {
  if (
    seed.revision !== manifest.revision ||
    seed.feeds.length !== manifest.feeds.length ||
    new Set(seed.feeds.map((feed) => feed.url)).size !== seed.feeds.length
  )
    throw new ReviewAccountError('Invalid review seed revision or feeds');
  for (const expected of manifest.feeds) {
    const feed = seed.feeds.find((feed) => feed.key === expected.key);
    if (
      feed?.fetched.status !== 'updated' ||
      feed.fetched.publicRedirect ||
      digest(
        feed.fetched.data.episodes.map((episode) => episode.guid).sort(),
      ) !== digest(expected.episodes.map(reviewEpisodeGuid).sort())
    )
      throw new ReviewAccountError(
        'Sampler feed identities differ from the manifest',
      );
    for (const episode of feed.fetched.data.episodes) {
      if (
        !episode.published ||
        !episode.duration ||
        !Number.isInteger(episode.duration) ||
        episode.duration < 60 ||
        !episode.file?.length ||
        episode.file.type !== 'audio/mpeg'
      )
        throw new ReviewAccountError(
          'Sampler episode has invalid media or duration',
        );
    }
  }
  for (const progress of manifest.progress) {
    const episode = seed.feeds
      .flatMap((feed) => feed.fetched.data.episodes)
      .find((episode) => episode.guid === reviewEpisodeGuid(progress.episode));
    if (
      !episode ||
      (!progress.completed &&
        (!progress.positionSeconds ||
          progress.positionSeconds >= (episode.duration ?? 0)))
    )
      throw new ReviewAccountError('Seed progress is outside the episode');
  }
}

export async function applyReviewSeed(
  tx: postgres.TransactionSql,
  userId: string,
  seed: ResolvedReviewSeed,
) {
  validateReviewSeed(seed);
  await lockPodcastIdentities(
    tx,
    seed.feeds.map((feed) => ({ feedUrl: feed.url })),
  );
  const podcasts: string[] = [];
  const episodes = new Map<string, { id: string; duration: number }>();
  for (const feed of seed.feeds) {
    let podcast = await findPodcastIdentity(
      tx,
      feed.url,
      undefined,
      undefined,
      true,
    );
    if (
      podcast &&
      (feed.key === 'private' ||
        podcast.owner_user_id !== null ||
        podcast.feed_url !== feed.url)
    )
      throw new ReviewAccountError(
        'Sampler locator has a conflicting owner or canonical identity',
      );
    const { data } = feed.fetched;
    if (!podcast) {
      podcast = await insertPodcast(
        tx,
        feed.url,
        feed.key === 'private' ? userId : null,
        data,
      );
      if (!podcast)
        throw new ReviewAccountError('Sampler import identity conflict');
      await upsertEpisodes(tx, podcast.id, data.cover, data.episodes);
      await savePollState(tx, podcast.id, feed.fetched, getPollInterval(null));
    }
    const [metadata] = await tx`
      SELECT p.title, p.description, p.cover, p.website_url, p.explicit, a.name AS author
      FROM podcasts p JOIN authors a ON a.id = p.author_id WHERE p.id = ${podcast.id}
    `;
    if (
      digest(metadata) !==
      digest({
        title: data.title,
        description: data.description,
        cover: data.cover,
        website_url: data.link,
        explicit: data.explicit,
        author: data.author || 'Unknown',
      })
    )
      throw new ReviewAccountError(
        'Sampler catalogue metadata differs from the validated feed',
      );
    const expected = buildRows(data.episodes, data.cover).sort((a, b) =>
      a.guid.localeCompare(b.guid),
    );
    const stored = await tx`
      SELECT e.id::text, e.guid, c.title, c.summary, e.published, c.duration, c.episode_art,
        c.file_url, c.file_length::text, c.file_type
      FROM episodes e JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = ${podcast.id} ORDER BY e.guid
    `;
    const content = stored.map(({ id: _, ...row }) => ({
      ...row,
      published: row.published.toISOString(),
      file_length: Number(row.file_length),
    }));
    if (digest(content) !== digest(expected))
      throw new ReviewAccountError(
        'Sampler catalogue content differs from validated assets',
      );
    podcasts.push(podcast.id);
    for (const episode of stored)
      episodes.set(episode.guid, {
        id: episode.id,
        duration: episode.duration,
      });
  }
  const episodeFor = (key: string) => {
    const episode = episodes.get(reviewEpisodeGuid(key));
    if (!episode) throw new ReviewAccountError('Seed episode missing');
    return episode;
  };
  const { scope } = await readGeneration(tx, userId, true);
  const stream = { ...scope, clientId: randomUUID(), sequence: '1' };
  const follows = await changeFollowState(tx, userId, {
    ...stream,
    changes: podcasts.map((podcastId) => ({ podcastId, followed: true })),
  });
  const progress = await changeProgressState(tx, userId, {
    ...stream,
    changes: manifest.progress.map((item) => ({
      episodeId: episodeFor(item.episode).id,
      positionSeconds: item.completed
        ? episodeFor(item.episode).duration
        : (item.positionSeconds ?? 0),
      completed: item.completed,
    })),
  });
  if (
    [...follows.results, ...progress.results].some(
      (result) => result.status !== 'applied',
    )
  )
    throw new ReviewAccountError('Seed state was not applied');
  for (const list of [
    { kind: 'starred' as const, name: null, episodes: manifest.starred },
    {
      kind: 'playlist' as const,
      name: manifest.playlist.name,
      episodes: manifest.playlist.episodes,
    },
  ]) {
    const id = await insertEpisodeList(tx, userId, list.kind, list.name);
    if (!id) throw new ReviewAccountError('Seed list already exists');
    const result = await changeEpisodeList(
      tx,
      userId,
      id,
      scope,
      {
        ...scope,
        clientId: randomUUID(),
        sequence: '1',
        changes: list.episodes.map((key) => ({
          op: 'add' as const,
          episodeId: episodeFor(key).id,
        })),
      },
      false,
    );
    if (result.results.some((result) => result.status !== 'applied'))
      throw new ReviewAccountError('Seed list was not applied');
    for (const [index, key] of list.episodes.entries())
      await tx`UPDATE episode_list_items SET added_at = transaction_timestamp() - ${index} * interval '1 millisecond'
        WHERE list_id = ${id} AND episode_id = ${episodeFor(key).id}`;
  }
  await writePreferences(tx, userId, defaultPreferences);
}

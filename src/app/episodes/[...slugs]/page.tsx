import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PodcastEpisodeSchema, PodcastSeriesSchema } from '@/components/Schema';
import { getSession } from '@/server/auth/session';
import { EpisodeContentError } from '@/server/ingest/content-error';
import {
  getEpisodeById,
  getEpisodesPaginated,
  getPodcastByFeedUrl,
  getPodcastInfoById,
} from '@/server/ingest/podcast';
import { AccountContent } from '@/shared/auth/AccountBoundary';
import { isCanonicalId } from '@/shared/canonical-id';
import { translations } from '@/shared/i18n/server';
import { formatSecondsToTimestamp } from '@/shared/player/formatTime';
import { type Moment, parseMoment } from '@/shared/share-link';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { PaginatedEpisodesList } from '@/ui/EpisodesList';
import { EpisodesHydration } from '@/ui/EpisodesList/EpisodesHydration';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';
import { Related } from '@/ui/PodcastInfo/Related';
import { EpisodePreparing } from './EpisodePreparing';
import styles from './Episodes.module.css';
import { EpisodesNotFound } from './EpisodesNotFound';
import { FeedRefresh } from './FeedRefresh';

function contentFailure(error: unknown): EpisodeContentError {
  if (error instanceof EpisodeContentError) return error;
  throw error;
}

function isNumeric(str: string): boolean {
  return isCanonicalId(str);
}

type ParsedSlugs =
  | { type: 'id'; podcastId: string; episodeId: string | null }
  | { type: 'legacy'; feedUrl: string; guid: string | null };

function parseSlugs(slugs: string[]): ParsedSlugs {
  const first = slugs[0] || '';

  if (isNumeric(first)) {
    const podcastId = first;
    const episodeId = slugs[1] && isNumeric(slugs[1]) ? slugs[1] : null;
    return { type: 'id', podcastId, episodeId };
  }

  const joined = slugs.join('/');
  const feedUrl = joined.includes('://') ? joined : decodeURIComponent(joined);
  return { type: 'legacy', feedUrl, guid: null };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const all = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

async function sharedMoment(
  searchParams: SearchParams,
  duration: number | null,
) {
  const query = await searchParams;
  const times = all(query.t);
  const chapters = all(query.ch);
  if (!times.length && !chapters.length)
    return { moment: null, invalid: false };
  const moment = parseMoment(times, chapters);
  const playable = moment && (!duration || moment.start < duration);
  return playable
    ? { moment, invalid: false }
    : { moment: null, invalid: true };
}

async function momentTitle(moment: Moment | null, title: string) {
  if (!moment) return title;
  const { t } = await translations();
  const start = formatSecondsToTimestamp(moment.start);
  return `${
    moment.kind === 'time'
      ? t('share.listenFrom', { time: start })
      : t('share.listenClip', {
          start,
          end: formatSecondsToTimestamp(moment.end),
        })
  } · ${title}`;
}

function buildCleanUrl(podcastId: string, episodeId?: string | null): string {
  if (episodeId) {
    return `/episodes/${podcastId}/${episodeId}`;
  }
  return `/episodes/${podcastId}`;
}

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('host') || 'www.podcst.app';
  const proto = h.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

export async function generateMetadata(props: {
  params: Promise<{ slugs: string[] }>;
  searchParams: SearchParams;
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const parsed = parseSlugs(params.slugs);

  if (parsed.type === 'id' && parsed.episodeId) {
    const [episode, podcast] = await Promise.all([
      getEpisodeById(parsed.episodeId, null, parsed.podcastId).catch(
        contentFailure,
      ),
      getPodcastInfoById(parsed.podcastId),
    ]);
    if (episode instanceof EpisodeContentError && podcast) {
      const url = `/episodes/${parsed.podcastId}/${parsed.episodeId}`;
      return {
        title: `${podcast.title} · ${episode.freshness.state === 'pending' ? 'Episode preparing' : 'Episode unavailable'}`,
        description: 'Episode content is temporarily unavailable.',
        alternates: { canonical: url },
        openGraph: { url, images: podcast.cover },
      };
    }
    if (
      episode &&
      !(episode instanceof EpisodeContentError) &&
      podcast &&
      episode.podcastId === parsed.podcastId
    ) {
      const url = `/episodes/${parsed.podcastId}/${parsed.episodeId}`;
      const { moment } = await sharedMoment(
        props.searchParams,
        episode.duration,
      );
      const title = await momentTitle(moment, episode.title);
      return {
        title,
        description:
          episode.summary ||
          `Listen to ${episode.title} from ${podcast?.title || 'podcast'}`,
        openGraph: {
          url,
          images: podcast?.cover || episode.cover,
        },
        alternates: {
          canonical: url,
        },
      };
    }
  }

  if (parsed.type === 'id') {
    const podcast = await getPodcastInfoById(parsed.podcastId);
    if (podcast) {
      const url = `/episodes/${parsed.podcastId}`;
      return {
        title: podcast.title,
        description: podcast.description,
        openGraph: {
          url,
          images: podcast.cover,
        },
        alternates: {
          canonical: url,
        },
      };
    }
    return { robots: { index: false, follow: false } };
  }

  const info = await getPodcastByFeedUrl(parsed.feedUrl);

  if (!info) return {};

  if (parsed.guid) {
    const episode = info.episodes.find((ep) => ep.guid === parsed.guid);
    if (episode) {
      const url = info.id ? `/episodes/${info.id}/${episode.id}` : undefined;
      return {
        title: episode.title,
        description:
          episode.summary || `Listen to ${episode.title} from ${info.title}`,
        openGraph: {
          url,
          images: info.cover,
        },
        alternates: {
          canonical: url,
        },
      };
    }
  }

  const url = info.id ? `/episodes/${info.id}` : undefined;
  return {
    title: info.title,
    description: info.description,
    openGraph: {
      url,
      images: info.cover,
    },
    alternates: {
      canonical: url,
    },
  };
}

export default async function Page(props: {
  params: Promise<{ slugs: string[] }>;
  searchParams: SearchParams;
}) {
  const params = await props.params;
  const parsed = parseSlugs(params.slugs);
  const baseUrl = await getBaseUrl();
  const userId = (await getSession())?.userId ?? null;

  if (parsed.type === 'id') {
    if (parsed.episodeId) {
      const [episode, podcast] = await Promise.all([
        getEpisodeById(parsed.episodeId, userId, parsed.podcastId).catch(
          contentFailure,
        ),
        getPodcastInfoById(parsed.podcastId, userId),
      ]);

      if (!episode || !podcast || episode.podcastId !== parsed.podcastId) {
        return <EpisodesNotFound type="episode" />;
      }

      if (episode instanceof EpisodeContentError)
        return (
          <AccountContent
            scope={userId}
            resource={parsed.podcastId}
            privateContent={!!podcast.isPrivate}
          >
            <EpisodePreparing
              key={parsed.episodeId}
              podcastId={parsed.podcastId}
              freshness={episode.freshness}
            />
          </AccountContent>
        );

      const url = `${baseUrl}/episodes/${parsed.podcastId}/${parsed.episodeId}`;
      const podcastData = { ...podcast, episodes: [episode] };
      const shared = podcast.isPrivate
        ? { moment: null, invalid: false }
        : await sharedMoment(props.searchParams, episode.duration);

      return (
        <AccountContent
          scope={userId}
          resource={parsed.podcastId}
          privateContent={!!podcast.isPrivate}
        >
          <FeedRefresh podcastId={parsed.podcastId} />
          {!podcast.isPrivate && (
            <PodcastEpisodeSchema
              podcast={podcastData}
              episode={episode}
              url={url}
            />
          )}
          <EpisodeInfo
            podcast={podcast}
            episode={episode}
            moment={shared.moment}
            invalidMoment={shared.invalid}
          />
        </AccountContent>
      );
    }

    const [podcast, initialEpisodes] = await Promise.all([
      getPodcastInfoById(parsed.podcastId, userId),
      getEpisodesPaginated({ podcastId: parsed.podcastId, limit: 20 }, userId),
    ]);

    if (!podcast || !initialEpisodes) {
      return <EpisodesNotFound type="podcast" />;
    }

    if (initialEpisodes.episodes.length === 0) {
      return (
        <AccountContent
          scope={userId}
          resource={parsed.podcastId}
          privateContent={!!podcast.isPrivate}
        >
          <EpisodesHydration
            scope={userId}
            podcastId={parsed.podcastId}
            initialData={initialEpisodes}
          >
            <FeedRefresh
              podcastId={parsed.podcastId}
              empty
              initialFreshness={initialEpisodes.freshness}
            />
            <PodcastInfo podcast={podcast} episodes={[]} />
          </EpisodesHydration>
        </AccountContent>
      );
    }

    const url = `${baseUrl}/episodes/${parsed.podcastId}`;
    const schemaData = { ...podcast, episodes: initialEpisodes.episodes };

    return (
      <AccountContent
        scope={userId}
        resource={parsed.podcastId}
        privateContent={!!podcast.isPrivate}
      >
        <FeedRefresh
          podcastId={parsed.podcastId}
          initialFreshness={initialEpisodes.freshness}
        />
        {!podcast.isPrivate && (
          <PodcastSeriesSchema podcast={schemaData} url={url} />
        )}
        <EpisodesHydration
          scope={userId}
          podcastId={parsed.podcastId}
          initialData={initialEpisodes}
        >
          <PodcastInfo podcast={podcast} episodes={initialEpisodes.episodes} />
          <div className={styles.body}>
            <PaginatedEpisodesList podcast={podcast} />
            <Related podcastId={podcast.id} />
          </div>
        </EpisodesHydration>
      </AccountContent>
    );
  }

  let feedUrl = parsed.feedUrl;
  let guid = parsed.guid;
  let info = await getPodcastByFeedUrl(feedUrl);
  if (!info) {
    const idx = feedUrl.lastIndexOf('/');
    if (idx > 'https://'.length) {
      const altFeed = feedUrl.slice(0, idx);
      const alt = await getPodcastByFeedUrl(altFeed);
      if (alt) {
        info = alt;
        guid = feedUrl.slice(idx + 1);
        feedUrl = altFeed;
      }
    }
  }
  if (!info?.id) {
    return <EpisodesNotFound type="podcast" />;
  }

  let episodeId: string | null = null;
  if (guid) {
    const episode = info.episodes.find((ep) => ep.guid === guid);
    episodeId = episode?.id ?? null;
  }

  redirect(buildCleanUrl(info.id, episodeId));
}

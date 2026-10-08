import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PodcastEpisodeSchema, PodcastSeriesSchema } from '@/components/Schema';
import { getSession } from '@/server/auth/session';
import {
  getEpisodeById,
  getEpisodesPaginated,
  getPodcastByFeedUrl,
  getPodcastInfoById,
} from '@/server/ingest/podcast';
import { AccountContent } from '@/shared/auth/AccountBoundary';
import { isCanonicalId } from '@/shared/canonical-id';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { PaginatedEpisodesList } from '@/ui/EpisodesList';
import { EpisodesHydration } from '@/ui/EpisodesList/EpisodesHydration';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';
import { Related } from '@/ui/PodcastInfo/Related';
import styles from './Episodes.module.css';
import { EpisodesNotFound } from './EpisodesNotFound';
import { FeedRefresh } from './FeedRefresh';

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
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const parsed = parseSlugs(params.slugs);

  if (parsed.type === 'id' && parsed.episodeId) {
    const [episode, podcast] = await Promise.all([
      getEpisodeById(parsed.episodeId),
      getPodcastInfoById(parsed.podcastId),
    ]);
    if (episode && podcast && episode.podcastId === parsed.podcastId) {
      const url = `/episodes/${parsed.podcastId}/${parsed.episodeId}`;
      return {
        title: episode.title,
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
}) {
  const params = await props.params;
  const parsed = parseSlugs(params.slugs);
  const baseUrl = await getBaseUrl();
  const userId = (await getSession())?.userId ?? null;

  if (parsed.type === 'id') {
    if (parsed.episodeId) {
      const [episode, podcast] = await Promise.all([
        getEpisodeById(parsed.episodeId, userId),
        getPodcastInfoById(parsed.podcastId, userId),
      ]);

      if (!episode || !podcast || episode.podcastId !== parsed.podcastId) {
        return <EpisodesNotFound type="episode" />;
      }

      const url = `${baseUrl}/episodes/${parsed.podcastId}/${parsed.episodeId}`;
      const podcastData = { ...podcast, episodes: [episode] };

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
          <EpisodeInfo podcast={podcast} episode={episode} />
        </AccountContent>
      );
    }

    const [podcast, initialEpisodes] = await Promise.all([
      getPodcastInfoById(parsed.podcastId, userId),
      getEpisodesPaginated({ podcastId: parsed.podcastId, limit: 20 }, userId),
    ]);

    if (!podcast) {
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
            <FeedRefresh podcastId={parsed.podcastId} empty />
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
        <FeedRefresh podcastId={parsed.podcastId} />
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

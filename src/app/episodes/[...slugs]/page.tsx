import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PodcastEpisodeSchema, PodcastSeriesSchema } from '@/components/Schema';
import {
  getEpisodeById,
  getEpisodesPaginated,
  getPodcastByFeedUrl,
  getPodcastInfoById,
  ingestPodcast,
} from '@/server/ingest/podcast';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { PaginatedEpisodesList } from '@/ui/EpisodesList';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';
import { EmptyEpisodesRefresh } from './EmptyEpisodesRefresh';
import { EpisodesNotFound } from './EpisodesNotFound';

function isNumeric(str: string): boolean {
  return /^\d+$/.test(str);
}

type ParsedSlugs =
  | { type: 'id'; podcastId: number; episodeId: number | null }
  | { type: 'legacy'; feedUrl: string; guid: string | null };

function parseSlugs(slugs: string[]): ParsedSlugs {
  const first = slugs[0] || '';

  if (isNumeric(first)) {
    const podcastId = parseInt(first, 10);
    const episodeId =
      slugs[1] && isNumeric(slugs[1]) ? parseInt(slugs[1], 10) : null;
    return { type: 'id', podcastId, episodeId };
  }

  return {
    type: 'legacy',
    feedUrl: decodeURIComponent(first),
    guid: slugs[1] ? decodeURIComponent(slugs[1]) : null,
  };
}

function buildCleanUrl(podcastId: number, episodeId?: number | null): string {
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
    const episode = await getEpisodeById(parsed.episodeId);
    if (episode) {
      const podcast = await getPodcastInfoById(parsed.podcastId);
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
    return {};
  }

  let info = await getPodcastByFeedUrl(parsed.feedUrl);
  if (!info) {
    info = await ingestPodcast(parsed.feedUrl);
  }

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

  if (parsed.type === 'id') {
    if (parsed.episodeId) {
      const [episode, podcast] = await Promise.all([
        getEpisodeById(parsed.episodeId),
        getPodcastInfoById(parsed.podcastId),
      ]);

      if (!episode || !podcast || episode.podcastId !== parsed.podcastId) {
        return <EpisodesNotFound type="episode" />;
      }

      const url = `${baseUrl}/episodes/${parsed.podcastId}/${parsed.episodeId}`;
      const podcastData = { ...podcast, episodes: [episode] };

      return (
        <>
          <PodcastEpisodeSchema
            podcast={podcastData}
            episode={episode}
            url={url}
          />
          <EpisodeInfo podcast={podcastData} episode={episode} />
        </>
      );
    }

    const [podcast, initialEpisodes] = await Promise.all([
      getPodcastInfoById(parsed.podcastId),
      getEpisodesPaginated({ podcastId: parsed.podcastId, limit: 20 }),
    ]);

    if (!podcast) {
      return <EpisodesNotFound type="podcast" />;
    }

    if (initialEpisodes.episodes.length === 0) {
      const infoData = { ...podcast, episodes: [] };
      return (
        <>
          <PodcastInfo info={infoData} />
          <EmptyEpisodesRefresh podcastId={parsed.podcastId} />
        </>
      );
    }

    const url = `${baseUrl}/episodes/${parsed.podcastId}`;
    const schemaData = { ...podcast, episodes: initialEpisodes.episodes };
    const infoData = { ...podcast, episodes: [] };

    return (
      <>
        <PodcastSeriesSchema podcast={schemaData} url={url} />
        <PaginatedEpisodesList
          podcastId={parsed.podcastId}
          podcast={podcast}
          initialData={initialEpisodes}
        >
          <PodcastInfo info={infoData} />
        </PaginatedEpisodesList>
      </>
    );
  }

  let info = await getPodcastByFeedUrl(parsed.feedUrl);
  if (!info) {
    info = await ingestPodcast(parsed.feedUrl);
  }

  if (!info || !info.id) {
    return <EpisodesNotFound type="podcast" />;
  }

  let episodeId: number | null = null;
  if (parsed.guid) {
    const episode = info.episodes.find((ep) => ep.guid === parsed.guid);
    episodeId = episode?.id ?? null;
  }

  redirect(buildCleanUrl(info.id, episodeId));
}

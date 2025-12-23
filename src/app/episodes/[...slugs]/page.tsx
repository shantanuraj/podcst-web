import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getPodcastById, getPodcastByFeedUrl, ingestPodcast } from '@/server/ingest/podcast';
import { EpisodesSpaClient } from './EpisodesSpaClient';

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
    const episodeId = slugs[1] && isNumeric(slugs[1]) ? parseInt(slugs[1], 10) : null;
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

export async function generateMetadata(props: {
  params: Promise<{ slugs: string[] }>;
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const parsed = parseSlugs(params.slugs);

  let info;
  if (parsed.type === 'id') {
    info = await getPodcastById(parsed.podcastId);
  } else {
    info = await getPodcastByFeedUrl(parsed.feedUrl);
    if (!info) {
      info = await ingestPodcast(parsed.feedUrl);
    }
  }

  if (!info) return {};

  if (parsed.type === 'id' && parsed.episodeId) {
    const episode = info.episodes.find((ep) => ep.id === parsed.episodeId);
    if (episode) {
      return {
        title: episode.title,
        description: episode.summary || `Listen to ${episode.title} from ${info.title}`,
        openGraph: { images: info.cover },
      };
    }
  } else if (parsed.type === 'legacy' && parsed.guid) {
    const episode = info.episodes.find((ep) => ep.guid === parsed.guid);
    if (episode) {
      return {
        title: episode.title,
        description: episode.summary || `Listen to ${episode.title} from ${info.title}`,
        openGraph: { images: info.cover },
      };
    }
  }

  return {
    title: info.title,
    description: info.description,
    openGraph: { images: info.cover },
  };
}

export default async function Page(props: { params: Promise<{ slugs: string[] }> }) {
  const params = await props.params;
  const parsed = parseSlugs(params.slugs);

  if (parsed.type === 'id') {
    const info = await getPodcastById(parsed.podcastId);
    if (!info) {
      return <div>Podcast not found</div>;
    }

    const initialEpisodeId = parsed.episodeId;
    return (
      <EpisodesSpaClient
        podcastId={parsed.podcastId}
        initialEpisodeId={initialEpisodeId}
        initialData={info}
      />
    );
  }

  let info = await getPodcastByFeedUrl(parsed.feedUrl);
  if (!info) {
    info = await ingestPodcast(parsed.feedUrl);
  }

  if (!info || !info.id) {
    return <div>Podcast not found</div>;
  }

  let episodeId: number | null = null;
  if (parsed.guid) {
    const episode = info.episodes.find((ep) => ep.guid === parsed.guid);
    episodeId = episode?.id ?? null;
  }

  redirect(buildCleanUrl(info.id, episodeId));
}

import { create } from 'zustand';
import { type Moment, shareUrl } from '@/shared/share-link';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';

export type ShareMode = 'show' | 'episode' | 'time' | 'chapter' | 'clip';

export type SharedPodcast = Pick<
  IPodcastInfo,
  'id' | 'title' | 'author' | 'cover' | 'isPrivate'
>;

export type ShareRequest =
  | { podcast: SharedPodcast; episode?: undefined; mode: 'show' }
  | {
      podcast?: undefined;
      episode: IEpisodeInfo;
      mode: Exclude<ShareMode, 'show'>;
      chapter?: number;
    };

export const useShare = create<{
  request: ShareRequest | null;
  open: (request: ShareRequest) => void;
  close: () => void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

export const podcastShareUrl = (podcast: SharedPodcast) =>
  podcast.isPrivate ? null : shareUrl({ podcastId: podcast.id });

export const episodeShareUrl = (episode: IEpisodeInfo, moment?: Moment) =>
  episode.isPrivate || !episode.podcastId || !episode.id
    ? null
    : shareUrl({ podcastId: episode.podcastId, episodeId: episode.id, moment });

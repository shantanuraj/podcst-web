import { type Chapter, chapterTarget } from '@/shared/chapters';
import type { IEpisodeInfo } from '@/types';
import { getCurrentEpisode, type IPlayerState } from './usePlayer';

export function sameEpisode(first?: IEpisodeInfo, second?: IEpisodeInfo) {
  if (!first || !second) return false;
  return first.id && second.id
    ? first.id === second.id
    : first.feed === second.feed && first.guid === second.guid;
}

export function navigateChapter(
  player: IPlayerState,
  episode: IEpisodeInfo,
  chapters: Chapter[],
  direction: 'previous' | 'next',
) {
  if (!sameEpisode(getCurrentEpisode(player), episode)) return;
  const target = chapterTarget(chapters, player.seekPosition, direction);
  if (target !== null) player.seekOrStartAt(episode, target);
  else if (direction === 'previous') player.skipToPreviousEpisode();
  else player.skipToNextEpisode();
}

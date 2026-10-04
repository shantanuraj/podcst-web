import { type Chapter, chapterTarget } from '@/shared/chapters';
import type { IEpisodeInfo } from '@/types';
import { sameEpisode } from './episode-identity';
import { getCurrentEpisode, type IPlayerState } from './usePlayer';

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

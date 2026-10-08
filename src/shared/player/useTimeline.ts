import { type Chapter, currentChapterIndex } from '@/shared/chapters';
import type { IEpisodeInfo } from '@/types';
import { useChapters } from './useChapters';
import { getSeekPosition, usePlayer } from './usePlayer';

export interface Segment {
  start: number;
  length: number;
  fill: number;
}

export function segments(
  chapters: readonly Chapter[],
  position: number,
  duration: number,
): Segment[] {
  const starts = chapters.length ? chapters.map(({ start }) => start) : [0];
  return starts.map((start, index) => {
    const length = (starts[index + 1] ?? duration) - start;
    return {
      start,
      length,
      fill:
        length > 0 ? Math.min(Math.max((position - start) / length, 0), 1) : 0,
    };
  });
}

export function playableChapters(
  chapters: readonly Chapter[],
  duration: number,
) {
  const playable =
    duration > 0 ? chapters.filter(({ start }) => start < duration) : [];
  return playable.length > 1 ? playable : [];
}

export function useTimeline(episode: IEpisodeInfo) {
  const seekPosition = usePlayer(getSeekPosition);
  const measured = usePlayer((state) => state.duration);
  const duration = measured || episode.duration || 0;
  const timeline = playableChapters(useChapters(episode).chapters, duration);
  const position = Math.max(
    0,
    duration > 0 ? Math.min(seekPosition, duration) : seekPosition,
  );
  const index = currentChapterIndex(timeline, position);
  return {
    position,
    duration,
    chapters: timeline,
    chapter: index < 0 ? undefined : { ...timeline[index], index },
    segments: segments(timeline, position, duration),
  };
}

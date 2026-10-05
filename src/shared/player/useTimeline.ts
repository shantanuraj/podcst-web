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

export function useTimeline(episode: IEpisodeInfo) {
  const seekPosition = usePlayer(getSeekPosition);
  const measured = usePlayer((state) => state.duration);
  const duration = measured || episode.duration || 0;
  const { chapters: all } = useChapters(episode);
  const chapters =
    duration > 0 ? all.filter(({ start }) => start < duration) : [];
  const timeline = chapters.length > 1 ? chapters : [];
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

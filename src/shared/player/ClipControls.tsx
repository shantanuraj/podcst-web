'use client';

import { useEpisodeProgress } from '@/data/progress';
import { chapterEnd } from '@/shared/chapters';
import { useTranslation } from '@/shared/i18n';
import type { IEpisodeInfo } from '@/types';
import styles from './ClipControls.module.css';
import { formatDuration, formatSecondsToTimestamp } from './formatTime';
import { type Clip, isClipping, usePlayer } from './usePlayer';
import { useTimeline } from './useTimeline';

export function useClip(episode: IEpisodeInfo) {
  return usePlayer((state) =>
    isClipping(state, episode) ? state.clip : undefined,
  );
}

export function clipLabel(
  t: ReturnType<typeof useTranslation>['t'],
  clip: Clip,
) {
  if (clip.ended)
    return t('share.clipEnded', { time: formatSecondsToTimestamp(clip.end) });
  return clip.chapter
    ? t('share.chapterBadge', {
        number: clip.chapter.number,
        title: clip.chapter.title,
      })
    : t('share.clipBadge', {
        start: formatSecondsToTimestamp(clip.start),
        end: formatSecondsToTimestamp(clip.end),
      });
}

export function ClipStrip({ clip }: { clip: Clip }) {
  const { duration, position } = useTimeline(clip.episode);
  if (!duration) return null;
  const at = (seconds: number) => `${(seconds / duration) * 100}%`;
  return (
    <span className={styles.strip} aria-hidden="true">
      <span
        className={styles.range}
        style={{ left: at(clip.start), width: at(clip.end - clip.start) }}
      />
      <span
        className={styles.played}
        style={{
          left: at(clip.start),
          width: at(
            Math.min(Math.max(position, clip.start), clip.end) - clip.start,
          ),
        }}
      />
    </span>
  );
}

export function SavedPlace({ episode }: { episode: IEpisodeInfo }) {
  const { t } = useTranslation();
  const saved = useEpisodeProgress(episode.id ? [episode.id] : []).get(
    episode.id ?? '',
  );
  if (!saved || saved.completed || saved.position <= 0) return null;
  return (
    <p className={styles.saved}>
      {t('share.savedPlace', {
        time: formatSecondsToTimestamp(saved.position),
      })}
    </p>
  );
}

export function ClipEnd({
  clip,
  queueable,
}: {
  clip: Clip;
  queueable?: boolean;
}) {
  const { t } = useTranslation();
  const { chapters, duration } = useTimeline(clip.episode);
  const player = usePlayer.getState();
  const following = clip.chapter ? chapters[clip.chapter.number] : undefined;
  const next =
    clip.chapter && following
      ? {
          start: following.start,
          end: chapterEnd(chapters, clip.chapter.number, duration),
          chapter: {
            number: clip.chapter.number + 1,
            title:
              following.title ||
              t('chapters.untitled', { number: clip.chapter.number + 1 }),
          },
        }
      : undefined;
  return (
    <div className={styles.end}>
      {next ? (
        <button
          type="button"
          className={styles.primary}
          onClick={() => player.retargetClip(next)}
        >
          <PlayGlyph />
          <span>
            {t('share.nextChapter')}
            <small>
              {next.chapter.title} · {formatDuration(t, next.end - next.start)}
            </small>
          </span>
        </button>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={player.keepListening}
        >
          <PlayGlyph />
          {t('share.keepListening', {
            time: formatSecondsToTimestamp(clip.end),
          })}
        </button>
      )}
      <button type="button" onClick={player.replayClip}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
        </svg>
        {t(clip.chapter ? 'share.replayChapter' : 'share.replayClip')}
      </button>
      {queueable && (
        <button type="button" onClick={player.queueClipEpisode}>
          {t('share.queueEpisode')}
        </button>
      )}
      <button type="button" className={styles.close} onClick={player.closeClip}>
        {t('share.close')}
      </button>
    </div>
  );
}

export function PlayFull() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={styles.full}
      onClick={usePlayer.getState().playFullEpisode}
    >
      {t('share.playFull')}
    </button>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-fill>
      <path d="M7 4.5v15l12.5-7.5z" />
    </svg>
  );
}

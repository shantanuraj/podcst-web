'use client';

import { SubscribeButton } from '@/components/SubscribeButton/SubscribeButton';
import { useEpisodeProgress } from '@/data/progress';
import { useTranslation } from '@/shared/i18n';
import { sameEpisode } from '@/shared/player/episode-identity';
import {
  formatDuration,
  formatLength,
  formatSecondsToTimestamp,
} from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { useChapters } from '@/shared/player/useChapters';
import {
  type ClipRange,
  getCurrentEpisode,
  usePlayer,
} from '@/shared/player/usePlayer';
import type { Moment } from '@/shared/share-link';
import { useToast } from '@/shared/toast/useToast';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './EpisodeInfo.module.css';

type Ranged = Exclude<Moment, { kind: 'time' }>;

export function SharedEyebrow({
  episode,
  moment,
}: {
  episode: IEpisodeInfo;
  moment: Moment;
}) {
  const { t } = useTranslation();
  const { chapters } = useChapters(episode);
  return (
    <p className={styles.eyebrow} data-shared>
      {moment.kind === 'time'
        ? t('share.sharedTime')
        : moment.kind === 'clip'
          ? t('share.sharedClip')
          : `${t('share.sharedChapter')} · ${
              chapters[moment.chapter - 1]?.title ||
              t('chapters.untitled', { number: moment.chapter })
            }`}
    </p>
  );
}

export function PlayFromTime({
  episode,
  start,
}: {
  episode: IEpisodeInfo;
  start: number;
}) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const time = formatSecondsToTimestamp(start);
  return (
    <Button
      type="button"
      data-variant="primary"
      onClick={() =>
        withAccount(episode, () => {
          usePlayer.getState().playEpisode(episode, start);
          useToast.getState().showToast(t('share.startedAt', { time }), {
            label: t('share.fromStart'),
            run: () =>
              withAccount(episode, () =>
                usePlayer.getState().seekOrStartAt(episode, 0),
              ),
          });
        })
      }
    >
      <Icon icon="play" size={16} />
      {t('share.playFrom', { time })}
    </Button>
  );
}

function useClipRange(episode: IEpisodeInfo, moment: Ranged): ClipRange {
  const { t } = useTranslation();
  const { chapters } = useChapters(episode);
  if (moment.kind === 'clip') return moment;
  const chapter = chapters[moment.chapter - 1];
  return {
    start: moment.start,
    end: moment.end,
    chapter: {
      number: moment.chapter,
      title:
        chapter?.title || t('chapters.untitled', { number: moment.chapter }),
    },
  };
}

export function ClipActions({
  podcast,
  episode,
  moment,
}: {
  podcast: IPodcastInfo;
  episode: IEpisodeInfo;
  moment: Ranged;
}) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const range = useClipRange(episode, moment);
  const saved = useEpisodeProgress(episode.id ? [episode.id] : []).get(
    episode.id ?? '',
  );
  const clip = usePlayer((state) => {
    const current = state.clip;
    return current &&
      sameEpisode(getCurrentEpisode(state), episode) &&
      current.start === range.start &&
      current.end === range.end
      ? state.state
      : null;
  });
  const playing = clip === 'playing' || clip === 'buffering';
  const chapter = moment.kind === 'chapter';

  const primary = () =>
    withAccount(episode, () => {
      const player = usePlayer.getState();
      if (clip) return player.togglePlayback();
      player.playClip(episode, range);
    });

  const full = () =>
    withAccount(episode, () => {
      const player = usePlayer.getState();
      if (player.clip && sameEpisode(player.clip.episode, episode)) {
        player.playFullEpisode();
        return player.resumeEpisode();
      }
      player.playEpisode(
        episode,
        saved && !saved.completed ? saved.position : 0,
      );
    });

  return (
    <div className={styles.actions}>
      <Button type="button" data-variant="primary" onClick={primary}>
        <Icon icon={playing ? 'pause' : 'play'} size={16} />
        {playing
          ? t('share.pauseClip')
          : t(chapter ? 'share.playChapter' : 'share.playClip')}
      </Button>
      <Button type="button" onClick={full}>
        {t('share.playFull')}
      </Button>
      <SubscribeButton info={{ ...podcast, episodes: [] }} />
      <p className={styles.range}>
        {t('share.range', {
          start: formatSecondsToTimestamp(range.start),
          end: formatSecondsToTimestamp(range.end),
          length: formatLength(t, range.end - range.start),
          total: episode.duration ? formatDuration(t, episode.duration) : '—',
        })}
      </p>
    </div>
  );
}

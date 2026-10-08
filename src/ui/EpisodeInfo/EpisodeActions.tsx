'use client';

import type { ReactNode } from 'react';
import { useMarkPlayed, usePodcastProgress } from '@/data/progress';
import { useDurableState } from '@/data/state-browser';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { sameEpisode } from '@/shared/player/episode-identity';
import { formatDuration } from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import { useToast } from '@/shared/toast/useToast';
import type { IEpisodeInfo } from '@/types';
import { Button } from '@/ui/Button';
import { ShareButton } from '@/ui/Button/ShareButton';
import { StarButton } from '@/ui/Button/StarButton';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './EpisodeInfo.module.css';
import { GuestProgressTransfer } from './GuestProgressTransfer';

export function EpisodeActions({
  episode,
  leading,
}: {
  episode: IEpisodeInfo;
  leading?: ReactNode;
}) {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const withAccount = useAccountPlayback();
  const durable = useDurableState();
  const saved = usePodcastProgress(episode.podcastId).get(episode.id ?? '');
  const markPlayed = useMarkPlayed(episode.podcastId);
  const current = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode) && state.state !== 'idle'
      ? state.state
      : null,
  );
  const live = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode) ? state.seekPosition : null,
  );
  const duration = episode.duration || 0;
  const position = live ?? (saved?.completed ? 0 : (saved?.position ?? 0));
  const playing = current === 'playing' || current === 'buffering';
  const resumable = position > 0 && !saved?.completed;
  const fraction = duration > 0 ? Math.min(position / duration, 1) : 0;

  const primary = () =>
    withAccount(episode, () => {
      const player = usePlayer.getState();
      if (current) return player.togglePlayback();
      player.playEpisode(episode, resumable ? position : 0);
    });

  return (
    <div className={styles.actions}>
      {leading}
      <Button
        type="button"
        data-variant="primary"
        className={styles.resume}
        onClick={primary}
      >
        <Icon icon={playing ? 'pause' : 'play'} size={16} />
        {playing
          ? t('player.pause')
          : resumable
            ? t('player.resume')
            : saved?.completed
              ? t('episode.playAgain')
              : t('player.play')}
        {!playing && resumable && duration > 0 && (
          <span className={styles.left}>
            {t('player.remaining', {
              time: formatDuration(t, duration - position),
            })}
          </span>
        )}
        {resumable && (
          <span
            className={styles.strip}
            style={{ width: `${fraction * 100}%` }}
          />
        )}
      </Button>
      <Button
        type="button"
        onClick={() =>
          withAccount(episode, () => {
            usePlayer.getState().enqueueEpisode(episode, false);
            useToast.getState().showToast(t('episode.queued'));
          })
        }
      >
        {t('podcast.addToQueue')}
      </Button>
      <StarButton episode={episode} showLabel />
      {episode.id && <GuestProgressTransfer episodeId={episode.id} />}
      {user && episode.id && !saved?.completed && (
        <Button
          type="button"
          disabled={markPlayed.isPending}
          onClick={() =>
            withAccount(episode, () => {
              const player = usePlayer.getState();
              if (sameEpisode(getCurrentEpisode(player), episode))
                player.markPlayed();
              else if (episode.id) markPlayed.mutate(episode.id);
            })
          }
        >
          {t('player.markPlayed')}
        </Button>
      )}
      {user && episode.id && saved?.completed && (
        <Button
          type="button"
          onClick={() => {
            if (episode.id)
              void durable.sync
                .progress(episode.id, 'unplayed', 0)
                .catch(() => {});
          }}
        >
          Mark unplayed
        </Button>
      )}
      {(durable.error || durable.pending) && (
        <span role="status">
          {durable.error ?? 'Saved on this device. Waiting to sync…'}
        </span>
      )}
      <ShareButton request={{ mode: 'episode', episode }} />
    </div>
  );
}

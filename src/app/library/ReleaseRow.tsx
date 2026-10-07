'use client';

import { useTranslation } from '@/shared/i18n';
import { getEpisodeHref } from '@/shared/links';
import { sameEpisode } from '@/shared/player/episode-identity';
import { formatDuration } from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import type { EpisodeProgress, IEpisodeInfo } from '@/types';
import { StarButton } from '@/ui/Button/StarButton';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Library.module.css';

export function ReleaseRow({
  episode,
  when,
  progress,
}: {
  episode: IEpisodeInfo;
  when: string | null;
  progress?: EpisodeProgress;
}) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const replaying = usePlayer(
    (state) =>
      sameEpisode(getCurrentEpisode(state), episode) &&
      (state.state === 'playing' || state.state === 'buffering'),
  );
  const completed = progress?.completed === true && !replaying;
  return (
    <li className={styles.release} data-played={completed}>
      <ProxiedImage
        alt=""
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        sizes="44px"
        loading="lazy"
      />
      <div className={styles.releaseText}>
        <PageLink
          href={getEpisodeHref(episode)}
          loading="podcast"
          className={styles.releaseTitle}
        >
          {episode.title}
        </PageLink>
        <span className={styles.meta}>
          {[episode.podcastTitle, when, completed ? t('podcast.played') : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <span className={styles.duration}>
        {episode.duration ? formatDuration(t, episode.duration) : ''}
      </span>
      <StarButton episode={episode} />
      <button
        type="button"
        className={styles.releasePlay}
        aria-label={`${t('player.play')} ${episode.title}`}
        onClick={() =>
          withAccount(episode, () => usePlayer.getState().playEpisode(episode))
        }
      >
        <Icon icon="play" size={12} />
      </button>
    </li>
  );
}

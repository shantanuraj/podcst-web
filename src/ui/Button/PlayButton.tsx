'use client';

import { forwardRef, memo, useCallback } from 'react';
import { useTranslation } from '@/shared/i18n';
import { sameEpisode } from '@/shared/player/episode-identity';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import {
  getCurrentEpisode,
  getPlaybackState,
  type IPlayerState,
  usePlayer,
} from '@/shared/player/usePlayer';

import type { IEpisodeInfo } from '@/types';
import { Icon } from '@/ui/icons/svg/Icon';
import { Button, type ButtonProps } from './Button';
import styles from './Button.module.css';

export type PlayButtonProps = ButtonProps & {
  episode: IEpisodeInfo;
  icon?: boolean;
};

export const PlayButton = memo(
  forwardRef<HTMLButtonElement, PlayButtonProps>(function PlayButton(
    { episode, icon, ...props },
    ref,
  ) {
    const withAccount = useAccountPlayback();
    const state = usePlayer(getPlaybackState);
    const isCurrentEpisode = usePlayer(
      useCallback(selectIsCurrentEpisode(episode), []),
    );
    const isPlaying =
      isCurrentEpisode && (state === 'playing' || state === 'buffering');

    const play = usePlayer(selectPlay);
    const resume = usePlayer(selectResume);
    const pause = usePlayer(selectPause);

    const children = icon ? PlayButtonIconContent : PlayButtonContent;
    const className =
      `${props.className || ''} ${icon ? styles.withIcon : ''}`.trim();

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        withAccount(episode, () => {
          if (!isCurrentEpisode) return play(episode);
          if (isPlaying) pause();
          else resume();
        });
      },
      [episode, isPlaying, play, resume, pause, isCurrentEpisode, withAccount],
    );

    return (
      <Button
        {...props}
        className={className}
        ref={ref}
        onClick={handleClick}
        data-is-current={isCurrentEpisode}
      >
        {children({ isCurrentEpisode, isPlaying })}
      </Button>
    );
  }),
);

PlayButton.displayName = 'PlayButton';

const PlayButtonContent = (props: {
  isCurrentEpisode: boolean;
  isPlaying: boolean;
}) => {
  const { t } = useTranslation();
  const { isCurrentEpisode, isPlaying } = props;
  return isCurrentEpisode
    ? isPlaying
      ? t('player.pause')
      : t('player.resume')
    : t('player.play');
};

const PlayButtonIconContent = ({
  isCurrentEpisode,
  isPlaying,
}: {
  isCurrentEpisode: boolean;
  isPlaying: boolean;
}) => {
  return (
    <Icon icon={isCurrentEpisode && isPlaying ? 'pause' : 'play'} size={30} />
  );
};

const selectIsCurrentEpisode =
  (episode: IEpisodeInfo) => (playerState: IPlayerState) =>
    sameEpisode(getCurrentEpisode(playerState), episode) &&
    playerState.state !== 'idle';
const selectPlay = (playerState: IPlayerState) => playerState.playEpisode;
const selectResume = (playerState: IPlayerState) => playerState.resumeEpisode;
const selectPause = (playerState: IPlayerState) => playerState.pause;

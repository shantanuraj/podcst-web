'use client';

import Link from 'next/link';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type KeyboardShortcuts,
  useKeydown,
} from '@/shared/keyboard/useKeydown';
import { Icon } from '@/ui/icons/svg/Icon';
import { ProxiedImage } from '@/ui/Image';

import { Airplay } from './Airplay';
import { Chromecast } from './Chromecast';
import { Duration } from './Duration';
import { PlaybackRate } from './PlaybackRate';
import styles from './Player.module.css';
import { Seekbar } from './Seekbar';
import {
  getCurrentEpisode,
  getIsPlayerOpen,
  getPlaybackState,
  usePlayer,
} from './usePlayer';
import { usePlaybackSync } from './usePlaybackSync';
import { VolumeControls } from './VolumeControls';
import { getEpisodeHref } from '../links';

const {
  togglePlayback,
  seekBackward,
  seekForward,
  setOverridenRate,
  skipToNextEpisode,
  skipToPreviousEpisode,
} = usePlayer.getState();

function overrideRate(e: React.MouseEvent) {
  const { target } = e;
  if ((target as HTMLElement).dataset.rateControl === undefined) {
    return;
  }
  setOverridenRate(2);
}

function resetRate() {
  setOverridenRate(undefined);
}

export const Player = () => {
  const currentEpisode = usePlayer(getCurrentEpisode);
  const open = usePlayer(getIsPlayerOpen);

  usePlaybackSync();
  useKeydown(open ? playerShortcuts : emptyShortcuts);

  return (
    <div className={styles.container} data-open={open}>
      {currentEpisode && (
        <div className={styles.player}>
          <Seekbar currentEpisode={currentEpisode} />
          <div className={styles.content}>
            <Link
              href={getEpisodeHref(currentEpisode)}
              className={styles.artwork}
            >
              <ProxiedImage alt="" src={currentEpisode.cover} />
            </Link>
            <div
              className={styles.info}
              data-rate-control
              onMouseDown={overrideRate}
              onMouseUp={resetRate}
            >
              <p className={styles.episodeTitle}>{currentEpisode.title}</p>
              <p className={styles.podcastName}>{currentEpisode.author}</p>
            </div>
            <Duration />
            <div className={styles.controls}>
              <button onClick={seekBackward} aria-label="Seek backward">
                <Icon icon="seek-back" size={20} />
              </button>
              <PlayButton />
              <button onClick={seekForward} aria-label="Seek forward">
                <Icon icon="seek-forward" size={20} />
              </button>
            </div>
            <PlaybackRate />
            <div className={styles.desktopOnly}>
              <VolumeControls />
              <Link href="/queue" aria-label="View queue">
                <Icon icon="queue-list" size={20} />
              </Link>
              <Airplay />
              <Chromecast />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function PlayButton() {
  const state = usePlayer(getPlaybackState);
  return (
    <button
      onClick={togglePlayback}
      className={styles.playButton}
      aria-label={state === 'playing' ? 'Pause' : 'Play'}
    >
      <Icon icon={state === 'playing' ? 'pause' : 'play'} size={24} />
    </button>
  );
}

const playerShortcuts: KeyboardShortcuts = (router) => [
  [
    shortcuts.info,
    () => {
      const { currentTrackIndex, queue } = usePlayer.getState();
      const currentEpisode = queue[currentTrackIndex];
      if (currentEpisode) {
        router.push(getEpisodeHref(currentEpisode));
      }
    },
  ],
  [
    shortcuts.queue,
    () => {
      router.push('/queue');
    },
  ],
  [
    shortcuts.togglePlayback,
    (e) => {
      e.preventDefault();
      togglePlayback();
    },
  ],
  [shortcuts.seekBack, seekBackward],
  [shortcuts.seekAhead, seekForward],
  [shortcuts.previousEpisode, skipToPreviousEpisode],
  [shortcuts.nextEpisode, skipToNextEpisode],
];

const emptyShortcuts: KeyboardShortcuts = () => [];

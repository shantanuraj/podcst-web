'use client';

import Link from 'next/link';

import { Icon } from '@/ui/icons/svg/Icon';
import { KeyboardShortcuts, useKeydown } from '@/shared/keyboard/useKeydown';
import { shortcuts } from '@/shared/keyboard/shortcuts';

import { Airplay } from './Airplay';
import { Chromecast } from './Chromecast';
import { Duration } from './Duration';
import { PlaybackRate } from './PlaybackRate';
import { Seekbar } from './Seekbar';
import { getCurrentEpisode, getIsPlayerOpen, getPlaybackState, usePlayer } from './usePlayer';
import { VolumeControls } from './VolumeControls';

import styles from './Player.module.css';

const {
  togglePlayback,
  seekBackward,
  seekForward,
  setOverridenRate,
  skipToNextEpisode,
  skipToPreviousEpisode,
} = usePlayer.getState();

function overrideRate() {
  setOverridenRate(2);
}

function resetRate() {
  setOverridenRate(undefined);
}

export const Player = () => {
  const currentEpisode = usePlayer(getCurrentEpisode);
  const open = usePlayer(getIsPlayerOpen);

  useKeydown(open ? playerShortcuts : emptyShortcuts);

  return (
    <div className={styles.container} data-open={open}>
      {currentEpisode && (
        <div
          className={styles.player}
          data-surface={1}
          onMouseDown={overrideRate}
          onMouseUp={resetRate}
        >
          <Seekbar currentEpisode={currentEpisode} />
          <Link
            href={`/episode/${encodeURIComponent(currentEpisode.feed)}/${encodeURIComponent(
              currentEpisode.guid,
            )}`}
            className={styles.imageCoverLink}
          >
            <img
              alt={`${currentEpisode.title} by ${currentEpisode.author}`}
              src={currentEpisode.cover}
            />
          </Link>
          <Duration />
          <div className={styles.controlInfoGroup}>
            <div className={styles.info}>
              <p className={styles.title}>{currentEpisode.title}</p>
              <p className={styles.author}>{currentEpisode.author}</p>
            </div>
            <div className={styles.controls}>
              <button onClick={seekBackward}>
                <Icon icon="seek-back" size={30} />
              </button>
              <PlayButton />
              <button onClick={seekForward}>
                <Icon icon="seek-forward" size={30} />
              </button>
            </div>
            <div className={styles.desktopControls}>
              <VolumeControls />
            </div>
            <PlaybackRate />
            <Link href="/queue">
              <Icon icon="queue-list" size={26}>
                <title>Add to queue</title>
              </Icon>
            </Link>
            <div className={styles.desktopControls}>
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
    <button onClick={togglePlayback} data-primary-control>
      <Icon icon={state === 'playing' ? 'pause' : 'play'} />
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
        router.push(
          `/episode/${encodeURIComponent(currentEpisode.feed)}/${encodeURIComponent(
            currentEpisode.guid,
          )}`,
        );
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

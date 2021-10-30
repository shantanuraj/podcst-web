import Link from 'next/link';
import router from 'next/router';

import { Icon } from '../../ui/icons/svg/Icon';
import { KeyboardShortcuts, useKeydown } from '../keyboard/useKeydown';
import { shortcuts } from '../keyboard/shortcuts';

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
  skipToNextEpisode,
  skipToPreviousEpisode,
} = usePlayer.getState();

export const Player = () => {
  const currentEpisode = usePlayer(getCurrentEpisode);
  const open = usePlayer(getIsPlayerOpen);

  useKeydown(open ? playerShortcuts : emptyShortcuts);

  return (
    <div className={styles.container} data-open={open}>
      {currentEpisode && (
        <div className={styles.player}>
          <Seekbar currentEpisode={currentEpisode} />
          <Link
            href={{
              pathname: '/episode',
              query: { feed: currentEpisode.feed, guid: currentEpisode.guid },
            }}
          >
            <a className={styles.imageCoverLink}>
              <img
                alt={`${currentEpisode.title} by ${currentEpisode.author}`}
                src={currentEpisode.cover}
              />
            </a>
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

const playerShortcuts: KeyboardShortcuts = [
  [
    shortcuts.info,
    () => {
      const { currentTrackIndex, queue } = usePlayer.getState();
      const currentEpisode = queue[currentTrackIndex];
      if (currentEpisode) {
        router.push({
          pathname: '/episode',
          query: { feed: currentEpisode.feed, guid: currentEpisode.guid },
        });
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
const emptyShortcuts: KeyboardShortcuts = [];

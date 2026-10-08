'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDurableState } from '@/data/state-browser';
import { useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type KeyboardShortcuts,
  useKeydown,
} from '@/shared/keyboard/useKeydown';
import type { IEpisodeInfo } from '@/types';
import { StarButton } from '@/ui/Button/StarButton';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';
import { speeds } from '../../../contracts/playback/rules.json';
import { getEpisodeHref } from '../links';
import { Airplay } from './Airplay';
import { Chromecast } from './Chromecast';
import { Equalizer } from './Equalizer';
import { NowPlaying } from './NowPlaying';
import styles from './Player.module.css';
import { SpeedMenu, useSpeedShortcuts } from './Speed';
import { Timeline } from './Timeline';
import { PlayPause, Transport } from './Transport';
import { usePlaybackSync } from './usePlaybackSync';
import { getCurrentEpisode, usePlayer } from './usePlayer';
import { usePreferenceSync } from './usePreferenceSync';
import { useTimeline } from './useTimeline';
import { VolumeControls } from './VolumeControls';

const HOLD_MS = 350;

export const Player = () => {
  const episode = usePlayer(getCurrentEpisode);
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);

  usePlaybackSync();
  usePreferenceSync();
  useSpeedShortcuts();
  useKeydown(episode ? playerShortcuts : emptyShortcuts);
  useKeydown(shortcuts.seekTo, seekToPercent);

  useEffect(() => {
    if (!episode) setExpanded(false);
  }, [episode]);

  return (
    <>
      <div className={styles.container} data-open={!!episode}>
        {episode && <PlayerBar episode={episode} onExpand={expand} />}
      </div>
      {episode && expanded && (
        <NowPlaying episode={episode} onClose={collapse} />
      )}
    </>
  );
};

function PlayerBar({
  episode,
  onExpand,
}: {
  episode: IEpisodeInfo;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const { chapter, position, duration } = useTimeline(episode);
  const playing = usePlayer((state) => state.state === 'playing');
  const hold = useHold(onExpand);
  const durable = useDurableState();

  return (
    <div className={styles.bar}>
      <span
        className={styles.progress}
        style={{ width: duration ? `${(position / duration) * 100}%` : 0 }}
        aria-hidden="true"
      />
      <div className={styles.now}>
        <button
          type="button"
          className={styles.artwork}
          onClick={onExpand}
          aria-label={t('player.open')}
        >
          <ProxiedImage
            alt=""
            src={episode.episodeArt || episode.cover}
            privateSource={episode.isPrivate}
            sizes="56px"
          />
        </button>
        <button type="button" className={styles.info} {...hold}>
          {chapter && (
            <span className={styles.chapter}>
              <Equalizer active={playing} />
              {t('player.chapterShort', { number: chapter.index + 1 })}
              {chapter.title ? ` · ${chapter.title}` : ''}
            </span>
          )}
          <span className={styles.title}>{episode.title}</span>
          <span className={styles.podcast}>
            {episode.podcastTitle || episode.author}
          </span>
          {(durable.error || durable.pending) && (
            <span className={styles.podcast} role="status">
              {durable.error ?? 'Saved on this device. Waiting to sync…'}
            </span>
          )}
        </button>
        <StarButton episode={episode} />
        <span className={styles.compact}>
          <PlayPause />
        </span>
      </div>
      <div className={styles.center}>
        <Transport episode={episode} size="bar" />
        <Timeline episode={episode} size="bar" />
      </div>
      <div className={styles.tools}>
        <SpeedMenu />
        <VolumeControls />
        <Link href="/queue" aria-label={t('player.queue')}>
          <Icon icon="queue-list" size={20} />
        </Link>
        <Airplay />
        <Chromecast />
        <button type="button" onClick={onExpand} aria-label={t('player.open')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function useHold(onTap: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  const release = () => {
    clearTimeout(timer.current);
    if (held.current) usePlayer.getState().setOverridenRate(undefined);
  };
  return {
    onPointerDown: () => {
      held.current = false;
      timer.current = setTimeout(() => {
        held.current = true;
        usePlayer.getState().setOverridenRate(speeds.hold);
      }, HOLD_MS);
    },
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release,
    onClick: () => {
      if (!held.current) onTap();
      held.current = false;
    },
  };
}

function seekToPercent(event: KeyboardEvent) {
  const player = usePlayer.getState();
  const episode = getCurrentEpisode(player);
  const duration = player.duration || episode?.duration || 0;
  const fraction = Number.parseInt(event.key, 10) / 10;
  if (episode && duration && Number.isFinite(fraction))
    player.seekOrStartAt(episode, Math.floor(fraction * duration));
}

const playerShortcuts: KeyboardShortcuts = (router) => [
  [
    shortcuts.info,
    () => {
      const episode = getCurrentEpisode(usePlayer.getState());
      if (episode) router.push(getEpisodeHref(episode));
    },
  ],
  [shortcuts.queue, () => router.push('/queue')],
  [
    shortcuts.togglePlayback,
    (e) => {
      e.preventDefault();
      usePlayer.getState().togglePlayback();
    },
  ],
  [shortcuts.seekBack, () => usePlayer.getState().seekBackward()],
  [shortcuts.seekAhead, () => usePlayer.getState().seekForward()],
  [
    shortcuts.previousEpisode,
    () => usePlayer.getState().skipToPreviousEpisode(),
  ],
  [shortcuts.nextEpisode, () => usePlayer.getState().skipToNextEpisode()],
];

const emptyShortcuts: KeyboardShortcuts = () => [];

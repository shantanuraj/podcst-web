'use client';

import Link from 'next/link';
import { type DragEvent, type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { getEpisodeHref } from '@/shared/links';
import { Equalizer } from '@/shared/player/Equalizer';
import { episodeKey } from '@/shared/player/episode-identity';
import { formatDuration } from '@/shared/player/formatTime';
import { upNext } from '@/shared/player/queue';
import { Timeline } from '@/shared/player/Timeline';
import { PlayPause } from '@/shared/player/Transport';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { usePlayer } from '@/shared/player/usePlayer';
import { useTimeline } from '@/shared/player/useTimeline';
import type { IEpisodeInfo } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './Queue.module.css';

export default function QueuePage() {
  const { t } = useTranslation();
  const queue = usePlayer((state) => state.queue);
  const current = usePlayer((state) => state.currentTrackIndex);
  const episode = queue[current];
  const next = useMemo(
    () => upNext({ queue, current, active: true }),
    [queue, current],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t('queue.title')}</h1>
          {episode && <Summary episode={episode} next={next} />}
        </div>
        {episode && (
          <button
            type="button"
            className={styles.outline}
            onClick={() => usePlayer.getState().clearQueue()}
          >
            {t('queue.clear')}
          </button>
        )}
      </header>
      {episode ? (
        <>
          <Current episode={episode} />
          <h2 className={styles.eyebrow}>{t('queue.upNext')}</h2>
          <UpNext episodes={next} />
        </>
      ) : (
        <p className={styles.empty}>{t('queue.empty')}</p>
      )}
    </div>
  );
}

function Summary({
  episode,
  next,
}: {
  episode: IEpisodeInfo;
  next: readonly IEpisodeInfo[];
}) {
  const { t } = useTranslation();
  const { position, duration } = useTimeline(episode);
  const left = next.reduce(
    (total, queued) => total + (queued.duration || 0),
    Math.max(duration - position, 0),
  );
  return (
    <p className={styles.eyebrow}>
      {t('queue.summary', {
        count: next.length + 1,
        time: formatDuration(t, left),
      })}
    </p>
  );
}

function Current({ episode }: { episode: IEpisodeInfo }) {
  const { t } = useTranslation();
  const { chapter, chapters } = useTimeline(episode);
  const playing = usePlayer((state) => state.state === 'playing');
  return (
    <section className={styles.current} aria-label={t('queue.nowPlaying')}>
      <ArtworkBackdrop
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        className={styles.tint}
      />
      <ProxiedImage
        alt=""
        className={styles.currentArt}
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        sizes="100px"
      />
      <div className={styles.currentText}>
        <p className={styles.nowPlaying}>
          <Equalizer active={playing} />
          {t('queue.nowPlaying')}
          {chapter &&
            ` · ${t('player.chapterOf', { number: chapter.index + 1, total: chapters.length })}`}
        </p>
        <Link href={getEpisodeHref(episode)} className={styles.currentTitle}>
          {episode.title}
        </Link>
        <Timeline episode={episode} size="bar" />
      </div>
      <PlayPause />
    </section>
  );
}

function UpNext({ episodes }: { episodes: readonly IEpisodeInfo[] }) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const { moveUpNext, removeUpNext } = usePlayer.getState();

  const over = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (dragged === null) return;
    event.preventDefault();
    const { top, height } = event.currentTarget.getBoundingClientRect();
    setTarget(event.clientY < top + height / 2 ? index : index + 1);
  };
  const drop = () => {
    if (dragged !== null && target !== null) moveUpNext(dragged, target);
    setDragged(null);
    setTarget(null);
  };
  const keyboard = (event: KeyboardEvent, index: number) => {
    if (!event.altKey) return;
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      moveUpNext(index, index - 1);
    } else if (event.key === 'ArrowDown' && index < episodes.length - 1) {
      event.preventDefault();
      moveUpNext(index, index + 2);
    }
  };

  if (!episodes.length) return null;
  return (
    <ol className={styles.list} onDragLeave={() => setTarget(null)}>
      {episodes.map((episode, index) => (
        <li
          key={episodeKey(episode)}
          className={styles.row}
          draggable
          data-dragging={dragged === index}
          data-drop={
            target === index
              ? 'before'
              : target === index + 1 && index === episodes.length - 1
                ? 'after'
                : undefined
          }
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            setDragged(index);
          }}
          onDragOver={(event) => over(event, index)}
          onDrop={drop}
          onDragEnd={drop}
        >
          <button
            type="button"
            className={styles.handle}
            aria-label={t('queue.reorder', { title: episode.title })}
            onKeyDown={(event) => keyboard(event, index)}
          >
            <span />
            <span />
            <span />
          </button>
          <span className={styles.number}>{index + 1}</span>
          <button
            type="button"
            className={styles.art}
            aria-label={`${t('player.play')} ${episode.title}`}
            onClick={() =>
              withAccount(episode, () =>
                usePlayer.getState().playEpisode(episode),
              )
            }
          >
            <ProxiedImage
              alt=""
              src={episode.episodeArt || episode.cover}
              privateSource={episode.isPrivate}
              sizes="52px"
            />
            <Icon icon="play" size={20} />
          </button>
          <div className={styles.text}>
            <Link href={getEpisodeHref(episode)} className={styles.title}>
              {episode.title}
            </Link>
            <span className={styles.podcast}>
              {episode.podcastTitle || episode.author}
            </span>
          </div>
          <div className={styles.actions}>
            {index > 0 && (
              <button
                type="button"
                className={styles.outline}
                onClick={() => moveUpNext(index, 0)}
              >
                {t('queue.playNext')}
              </button>
            )}
            <button
              type="button"
              className={styles.remove}
              onClick={() => removeUpNext([index])}
            >
              {t('queue.remove')}
            </button>
          </div>
          <span className={styles.duration}>
            {episode.duration ? formatDuration(t, episode.duration) : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

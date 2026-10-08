import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '@/shared/i18n';
import { sameEpisode } from '@/shared/player/episode-identity';
import {
  formatLength,
  formatSecondsToTimestamp,
} from '@/shared/player/formatTime';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import type { IEpisodeInfo } from '@/types';
import styles from './Share.module.css';
import { TimeInput } from './TimeInput';

const WINDOW_SECONDS = 480;

interface Range {
  start: number;
  end: number;
}

interface Frame {
  from: number;
  span: number;
}

export function frameFor({ start, end }: Range, duration: number): Frame {
  const total = duration || end + WINDOW_SECONDS;
  const span = Math.min(total, Math.max(WINDOW_SECONDS, (end - start) * 1.5));
  const from = (start + end) / 2 - span / 2;
  return { from: Math.min(Math.max(from, 0), total - span), span };
}

const percent = (value: number) => `${value * 100}%`;

export function ClipTrimmer({
  episode,
  range,
  duration,
  onChange,
}: {
  episode: IEpisodeInfo;
  range: Range;
  duration: number;
  onChange: (range: Range) => void;
}) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const startId = useId();
  const endId = useId();
  const [dragging, setDragging] = useState<Frame | null>(null);
  const total = duration || range.end + WINDOW_SECONDS;
  const frame = dragging ?? frameFor(range, duration);
  const at = (seconds: number) => (seconds - frame.from) / frame.span;
  const playhead = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode) ? state.seekPosition : null,
  );
  const preview = usePreview(episode, range);
  const minutes = Array.from(
    { length: Math.floor(frame.span / 60) + 1 },
    (_, index) => Math.ceil(frame.from / 60) * 60 + index * 60,
  ).filter((minute) => minute <= frame.from + frame.span);

  const set = (edge: keyof Range, seconds: number) => {
    const value = Math.round(seconds);
    onChange(
      edge === 'start'
        ? { ...range, start: Math.min(Math.max(value, 0), range.end - 1) }
        : { ...range, end: Math.max(Math.min(value, total), range.start + 1) },
    );
  };

  const handle = (edge: keyof Range) => ({
    role: 'slider',
    tabIndex: 0,
    className: styles.handle,
    style: { left: percent(at(range[edge])) },
    'aria-label': t(edge === 'start' ? 'share.clipStart' : 'share.clipEnd'),
    'aria-valuemin': edge === 'start' ? 0 : range.start + 1,
    'aria-valuemax': edge === 'start' ? range.end - 1 : Math.floor(total),
    'aria-valuenow': range[edge],
    'aria-valuetext': formatSecondsToTimestamp(range[edge]),
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(frame);
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      const box = track.current?.getBoundingClientRect();
      if (!dragging || !box) return;
      const fraction = (event.clientX - box.left) / box.width;
      set(edge, dragging.from + fraction * dragging.span);
    },
    onPointerUp: () => setDragging(null),
    onPointerCancel: () => setDragging(null),
    onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => {
      const step = event.shiftKey ? 10 : 1;
      const delta =
        event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -step
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? step
            : 0;
      if (!delta) return;
      event.preventDefault();
      set(edge, range[edge] + delta);
    },
  });

  return (
    <div className={styles.clip}>
      <div className={styles.trimmer}>
        <div className={styles.scale} aria-hidden="true">
          <span>{formatSecondsToTimestamp(frame.from)}</span>
          <span>{formatSecondsToTimestamp(frame.from + frame.span / 2)}</span>
          <span>{formatSecondsToTimestamp(frame.from + frame.span)}</span>
        </div>
        <div ref={track} className={styles.track}>
          {minutes.map((minute) => (
            <span
              key={minute}
              className={styles.tick}
              style={{ left: percent(at(minute)) }}
            />
          ))}
          <span
            className={styles.selection}
            style={{
              left: percent(at(range.start)),
              width: percent((range.end - range.start) / frame.span),
            }}
          />
          {playhead !== null &&
            playhead >= frame.from &&
            playhead <= frame.from + frame.span && (
              <span
                className={styles.playhead}
                style={{ left: percent(at(playhead)) }}
              />
            )}
          {preview.at !== null && (
            <span
              className={styles.playhead}
              data-preview
              style={{ left: percent(at(preview.at)) }}
            />
          )}
          <span {...handle('start')}>
            <span />
          </span>
          <span {...handle('end')}>
            <span />
          </span>
        </div>
        <div className={styles.strip} aria-hidden="true">
          <span
            className={styles.window}
            style={{
              left: percent(frame.from / total),
              width: percent(frame.span / total),
            }}
          />
          <span
            className={styles.part}
            style={{
              left: percent(range.start / total),
              width: percent((range.end - range.start) / total),
            }}
          />
        </div>
        <div className={styles.scale} aria-hidden="true">
          <span>{formatSecondsToTimestamp(0)}</span>
          <span>{formatSecondsToTimestamp(total)}</span>
        </div>
      </div>
      <div className={styles.times}>
        <div>
          <label htmlFor={startId}>{t('share.start')}</label>
          <TimeInput
            id={startId}
            value={range.start}
            max={range.end - 1}
            onChange={(seconds) => set('start', seconds)}
          />
        </div>
        <div>
          <label htmlFor={endId}>{t('share.end')}</label>
          <TimeInput
            id={endId}
            value={range.end}
            max={Math.floor(total)}
            onChange={(seconds) => set('end', seconds)}
          />
        </div>
        <span className={styles.length}>
          {formatLength(t, range.end - range.start)}
        </span>
        <button
          type="button"
          className={styles.preview}
          aria-pressed={preview.at !== null}
          onClick={preview.at === null ? preview.start : preview.stop}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {preview.at === null ? (
              <path d="M7 4.5v15l12.5-7.5z" />
            ) : (
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            )}
          </svg>
          {preview.at === null
            ? t('share.preview')
            : `${t('share.stopPreview')} · ${formatSecondsToTimestamp(preview.at)}`}
        </button>
      </div>
    </div>
  );
}

function usePreview(episode: IEpisodeInfo, range: Range) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const latest = useRef(range);
  const [at, setAt] = useState<number | null>(null);
  latest.current = range;

  const stop = () => {
    audio.current?.pause();
    setAt(null);
  };

  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  const start = () => {
    usePlayer.getState().pause();
    audio.current ??= new Audio(episode.file.url);
    const element = audio.current;
    element.currentTime = latest.current.start;
    element.ontimeupdate = () => {
      if (element.currentTime >= latest.current.end) stop();
      else setAt(element.currentTime);
    };
    setAt(latest.current.start);
    element.play().catch(stop);
  };

  return { at, start, stop };
}

/**
 * Howler player
 */

import { Howl } from 'howler/src/howler.core';
import { IEpisode } from '../../types';
import { updatePlaybackState } from './mediaUtils';

let globalHowl: Howl | null;

interface IAudioCallbacks {
  setPlaybackStarted: () => void;
  stopEpisode: () => void;
  seekUpdate?: (seconds: number) => void;
  duration?: (seconds: number) => void;
}

const throwError = () => {
  throw new Error('Audio.init not called!');
};

export default class AudioUtils {
  private static playbackId: number | undefined = undefined;

  public static callbacks: IAudioCallbacks = {
    setPlaybackStarted: throwError,
    stopEpisode: throwError,
  };

  public static init(callbacks: IAudioCallbacks) {
    AudioUtils.callbacks = callbacks;
  }

  public static play(episode: IEpisode) {
    AudioUtils.stop();
    AudioUtils.playbackId = undefined;
    globalHowl = new Howl({
      src: [episode.file.url],
      html5: true,
      onload() {
        AudioUtils.callbacks.setPlaybackStarted();
        AudioUtils.callbacks.duration?.(globalHowl?.duration() || 0);
        updatePlaybackState(globalHowl);
      },
      onplay() {
        const updateSeek = () =>
          requestAnimationFrame(() => {
            const seekPosition = globalHowl?.seek() as number;
            AudioUtils.callbacks.seekUpdate?.(seekPosition);

            if (globalHowl?.playing()) {
              setTimeout(updateSeek, 500);
            }
          });
        updateSeek();
      },
      onend() {
        AudioUtils.callbacks.stopEpisode();
      },
    });
    AudioUtils.playbackId = globalHowl.play();
  }

  public static pause() {
    globalHowl?.pause();
  }

  public static resume() {
    globalHowl?.play(AudioUtils.playbackId);
  }

  public static stop() {
    globalHowl?.stop();
    globalHowl?.unload();
  }

  public static skipTo(episode: IEpisode) {
    AudioUtils.pause();
    AudioUtils.play(episode);
  }

  public static seekTo(seconds: number) {
    globalHowl?.seek(seconds);
  }

  public static seekBy(seconds: number) {
    const seekPosition = globalHowl?.seek() as number;
    const duration = globalHowl?.duration() as number;
    const seekTo = seekPosition + seconds;
    AudioUtils.seekTo(normalizeSeek(seekTo, duration));
  }

  public static mute(muted: boolean) {
    globalHowl?.mute(muted, AudioUtils.playbackId);
  }

  public static getVolume() {
    return Math.floor((globalHowl?.volume() ?? 0) * 100);
  }

  /**
   * Set volume for playback
   * @param volume 0-100
   */
  public static setVolume(volume: number) {
    globalHowl?.volume(volume / 100, AudioUtils.playbackId || 0);
  }

  public static subscribeDuration(callback?: IAudioCallbacks['duration']) {
    AudioUtils.callbacks.duration = callback;
  }

  public static subscribeSeekUpdate(callback?: IAudioCallbacks['seekUpdate']) {
    AudioUtils.callbacks.seekUpdate = callback;
  }
}

/**
 * Normalize seek value to handle edge-cases
 */
const normalizeSeek = (seekTo: number, duration: number) => {
  if (seekTo < 0) {
    return 0;
  } else if (seekTo > duration) {
    return duration;
  }

  return Math.floor(seekTo);
};

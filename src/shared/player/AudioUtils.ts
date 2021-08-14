/**
 * Howler player
 */

import { Howl } from 'howler/src/howler.core';
import { IEpisode } from '../../types';
import { updatePlaybackState } from './mediaUtils';

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
  private static playbackInstance: Howl | null;
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
    AudioUtils.playbackInstance = new Howl({
      src: [episode.file.url],
      html5: true,
      onload() {
        AudioUtils.callbacks.setPlaybackStarted();
        AudioUtils.callbacks.duration?.(AudioUtils.playbackInstance?.duration() || 0);
        updatePlaybackState({
          duration: AudioUtils.playbackInstance?.duration() || 0,
          position: (AudioUtils.playbackInstance?.seek() as number) || 0,
          playbackRate: AudioUtils.playbackInstance?.rate() || 1,
        });
      },
      onplay() {
        const updateSeek = () =>
          requestAnimationFrame(() => {
            const seekPosition = AudioUtils.playbackInstance?.seek() as number;
            AudioUtils.callbacks.seekUpdate?.(seekPosition);

            if (AudioUtils.playbackInstance?.playing()) {
              setTimeout(updateSeek, 500);
            }
          });
        updateSeek();
      },
      onend() {
        AudioUtils.callbacks.stopEpisode();
      },
    });
    AudioUtils.playbackId = AudioUtils.playbackInstance.play();
  }

  public static pause() {
    AudioUtils.playbackInstance?.pause();
  }

  public static resume() {
    AudioUtils.playbackInstance?.play(AudioUtils.playbackId);
  }

  public static stop() {
    AudioUtils.playbackInstance?.stop();
    AudioUtils.playbackInstance?.unload();
  }

  public static skipTo(episode: IEpisode) {
    AudioUtils.pause();
    AudioUtils.play(episode);
  }

  public static seekTo(seconds: number) {
    AudioUtils.playbackInstance?.seek(seconds);
  }

  public static seekBy(seconds: number) {
    const seekPosition = AudioUtils.playbackInstance?.seek() as number;
    const duration = AudioUtils.playbackInstance?.duration() as number;
    const seekTo = seekPosition + seconds;
    AudioUtils.seekTo(normalizeSeek(seekTo, duration));
  }

  public static mute(muted: boolean) {
    AudioUtils.playbackInstance?.mute(muted, AudioUtils.playbackId);
  }

  public static getVolume() {
    return Math.floor((AudioUtils.playbackInstance?.volume() ?? 0) * 100);
  }

  /**
   * Set volume for playback
   * @param volume 0-100
   */
  public static setVolume(volume: number) {
    AudioUtils.playbackInstance?.volume(volume / 100, AudioUtils.playbackId || 0);
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

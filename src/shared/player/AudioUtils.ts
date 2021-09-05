/**
 * Howler player
 */

import { Howl } from 'howler/src/howler.core';
import { IEpisode } from '../../types';
import { updatePlaybackState } from './mediaUtils';

type AirplayAvailabilityCallback = (isAirplayAvailable: boolean) => void;

interface IAudioCallbacks {
  setPlaybackStarted: () => void;
  stopEpisode: () => void;
  seekUpdate: (seconds: number) => void;
  duration: (seconds: number) => void;
  setIsAirplayEnabled: AirplayAvailabilityCallback;
}

interface PlaybackTargetAvailabilityChangedEvent extends Event {
  availability?: 'available' | 'not-available';
}

interface AirplayAudioElement extends HTMLAudioElement {
  webkitShowPlaybackTargetPicker: () => void;
}

const throwError = () => {
  throw new Error('Audio.init not called!');
};

export default class AudioUtils {
  private static playbackInstance: Howl | null;
  private static playbackId: number | undefined = undefined;
  private static airplayAvailabilityListener: AirplayAvailabilityCallback | null = null;

  private static getAudioElement(): HTMLAudioElement | null {
    try {
      // @ts-expect-error Acessing untyped private API for howler
      const node = AudioUtils.playbackInstance?._sounds[0]._node;
      if (node instanceof HTMLAudioElement) {
        return node;
      }
      console.error('AudioUtils.getAudioElement Howler node not a regular element');
      return null;
    } catch (err) {
      console.error('AudioUtils.getAudioElement cannot extract audio element from howler');
      return null;
    }
  }

  private static playbackTargetAvailabilityChangeListener(
    e: PlaybackTargetAvailabilityChangedEvent,
  ) {
    AudioUtils.airplayAvailabilityListener?.(e.availability === 'available');
  }

  private static addAirplayAvailabilityListener(listener: AirplayAvailabilityCallback) {
    AudioUtils.airplayAvailabilityListener = listener;
    const audioElement = AudioUtils.getAudioElement();
    audioElement?.addEventListener(
      'webkitplaybacktargetavailabilitychanged',
      AudioUtils.playbackTargetAvailabilityChangeListener,
    );
  }

  public static removeAirplayAvailabilityListener() {
    if (!AudioUtils.airplayAvailabilityListener) return;
    AudioUtils.airplayAvailabilityListener = null;
    const audioElement = AudioUtils.getAudioElement();
    audioElement?.removeEventListener(
      'webkitplaybacktargetavailabilitychanged',
      AudioUtils.playbackTargetAvailabilityChangeListener,
    );
  }

  public static showAirplaySelector() {
    const audioElement = AudioUtils.getAudioElement() as AirplayAudioElement | null;
    audioElement?.webkitShowPlaybackTargetPicker();
  }

  public static callbacks: IAudioCallbacks = {
    seekUpdate: throwError,
    setPlaybackStarted: throwError,
    stopEpisode: throwError,
    duration: throwError,
    setIsAirplayEnabled: throwError,
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
        AudioUtils.callbacks.duration(AudioUtils.playbackInstance?.duration() || 0);
        updatePlaybackState({
          duration: AudioUtils.playbackInstance?.duration() || 0,
          position: (AudioUtils.playbackInstance?.seek() as number) || 0,
          playbackRate: AudioUtils.playbackInstance?.rate() || 1,
        });
        AudioUtils.getAudioElement()?.addEventListener(
          'timeupdate',
          AudioUtils.seekPositionListener,
        );
        AudioUtils.addAirplayAvailabilityListener(AudioUtils.callbacks.setIsAirplayEnabled);
      },
      onend() {
        AudioUtils.removeAirplayAvailabilityListener();
        AudioUtils.callbacks.stopEpisode();
        AudioUtils.getAudioElement()?.removeEventListener(
          'timeupdate',
          AudioUtils.seekPositionListener,
        );
        AudioUtils.removeAirplayAvailabilityListener();
      },
    });

    // Start playback
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

  private static seekPositionListener() {
    AudioUtils.callbacks.seekUpdate(AudioUtils.playbackInstance?.seek() as number);
  }

  public static setRate(rate: number) {
    if (!AudioUtils.playbackId) return;
    AudioUtils.playbackInstance?.rate(rate, AudioUtils.playbackId);
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

/**
 * Default Seek jump delta
 */
export const SEEK_DELTA = 10;

export const seekUtils = {
  seekBy: (currentPosition: number, seconds: number, duration: number) => {
    return normalizeSeek(currentPosition + seconds, duration);
  },
  seekForward: (currentPosition: number, duration: number) => {
    return seekUtils.seekBy(currentPosition, SEEK_DELTA, duration);
  },
  seekBackward: (currentPosition: number, duration: number) => {
    return seekUtils.seekBy(currentPosition, -SEEK_DELTA, duration);
  },
  onSeekSuccess: () => {}, // noop
  onSeekError: (error: chrome.cast.Error) => console.error('Error seeking', error),
};

import { Howl } from 'howler/src/howler.core';
import { getValue } from '@/shared/storage/local';
import type { IEpisode } from '@/types';
import { skip } from '../../../contracts/playback/rules.json';
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

export const defaultVolume = 50;
export const getInitialVolume = () => getValue('volume', defaultVolume);

export default class AudioUtils {
  private static playbackInstance: Howl | null = null;
  private static generation = 0;
  private static playbackId: number | undefined = undefined;
  private static airplayAvailabilityListener: AirplayAvailabilityCallback | null =
    null;
  private static volume: number = defaultVolume;
  private static rate = 1;

  private static getAudioElement(): HTMLAudioElement | null {
    try {
      // @ts-expect-error Acessing untyped private API for howler
      const node = AudioUtils.playbackInstance?._sounds[0]._node;
      if (node instanceof HTMLAudioElement) {
        return node;
      }
      console.error(
        'AudioUtils.getAudioElement Howler node not a regular element',
      );
      return null;
    } catch (_err) {
      console.error(
        'AudioUtils.getAudioElement cannot extract audio element from howler',
      );
      return null;
    }
  }

  private static playbackTargetAvailabilityChangeListener(
    e: PlaybackTargetAvailabilityChangedEvent,
  ) {
    AudioUtils.airplayAvailabilityListener?.(e.availability === 'available');
  }

  private static addAirplayAvailabilityListener(
    listener: AirplayAvailabilityCallback,
  ) {
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
    const audioElement =
      AudioUtils.getAudioElement() as AirplayAudioElement | null;
    audioElement?.webkitShowPlaybackTargetPicker();
  }

  public static callbacks: IAudioCallbacks = {
    seekUpdate: throwError,
    setPlaybackStarted: throwError,
    stopEpisode: throwError,
    duration: throwError,
    setIsAirplayEnabled: throwError,
  };

  public static init(callbacks: IAudioCallbacks, rate: number) {
    AudioUtils.callbacks = callbacks;
    AudioUtils.volume = getInitialVolume();
    AudioUtils.rate = rate;
  }

  public static loaded() {
    return AudioUtils.playbackInstance !== null;
  }

  public static play(
    episode: IEpisode,
    start: boolean = true,
    seekPosition: number = 0,
  ) {
    AudioUtils.stop();
    const generation = AudioUtils.generation;
    AudioUtils.playbackId = undefined;
    AudioUtils.playbackInstance = new Howl({
      src: [episode.file.url],
      volume: AudioUtils.volume / 100,
      rate: AudioUtils.rate,
      html5: true,
      onload() {
        if (generation !== AudioUtils.generation) return;
        AudioUtils.callbacks.setPlaybackStarted();
        AudioUtils.callbacks.duration(
          AudioUtils.playbackInstance?.duration() || 0,
        );
        updatePlaybackState({
          duration: AudioUtils.playbackInstance?.duration() || 0,
          position: (AudioUtils.playbackInstance?.seek() as number) || 0,
          playbackRate: AudioUtils.playbackInstance?.rate() || 1,
        });
        AudioUtils.getAudioElement()?.addEventListener(
          'timeupdate',
          AudioUtils.seekPositionListener,
        );
        AudioUtils.addAirplayAvailabilityListener(
          AudioUtils.callbacks.setIsAirplayEnabled,
        );
      },
      onplay(playbackId) {
        if (generation !== AudioUtils.generation) return;
        AudioUtils.playbackId = playbackId;
      },
      onend() {
        if (generation !== AudioUtils.generation) return;
        AudioUtils.removeAirplayAvailabilityListener();
        AudioUtils.callbacks.stopEpisode();
        AudioUtils.getAudioElement()?.removeEventListener(
          'timeupdate',
          AudioUtils.seekPositionListener,
        );
        AudioUtils.removeAirplayAvailabilityListener();
      },
    });

    AudioUtils.playbackInstance.seek(seekPosition);
    // Start playback
    if (start) AudioUtils.playbackId = AudioUtils.playbackInstance.play();
  }

  public static pause() {
    AudioUtils.playbackInstance?.pause();
  }

  public static resume() {
    AudioUtils.playbackInstance?.play(AudioUtils.playbackId);
  }

  public static stop() {
    AudioUtils.generation++;
    if (AudioUtils.playbackInstance) {
      AudioUtils.removeAirplayAvailabilityListener();
      AudioUtils.getAudioElement()?.removeEventListener(
        'timeupdate',
        AudioUtils.seekPositionListener,
      );
    }
    const instance = AudioUtils.playbackInstance;
    try {
      instance?.stop();
    } finally {
      try {
        instance?.unload();
      } finally {
        AudioUtils.playbackInstance = null;
        AudioUtils.playbackId = undefined;
      }
    }
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
    AudioUtils.volume = volume;
    AudioUtils.playbackInstance?.volume(
      volume / 100,
      AudioUtils.playbackId || 0,
    );
  }

  private static seekPositionListener() {
    AudioUtils.callbacks.seekUpdate(
      AudioUtils.playbackInstance?.seek() as number,
    );
  }

  public static setRate(rate: number) {
    AudioUtils.rate = rate;
    AudioUtils.playbackInstance?.rate(rate);
  }

  public static loadAtSeek(episode: IEpisode, seekPosition: number) {
    AudioUtils.play(episode, false);
    AudioUtils.seekTo(seekPosition);
  }
}

const clampSeek = (seconds: number, duration: number) =>
  Math.floor(Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds));

export const seekUtils = {
  seekForward: (position: number, duration: number) =>
    clampSeek(position + skip.forwardSeconds, duration),
  seekBackward: (position: number, duration: number) =>
    clampSeek(position - skip.backwardSeconds, duration),
  onSeekSuccess: () => {},
  onSeekError: (error: chrome.cast.Error) =>
    console.error('Error seeking', error),
};

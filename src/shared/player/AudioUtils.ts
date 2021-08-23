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

interface PlaybackTargetAvailabilityChangedEvent extends Event {
  availability?: 'available' | 'not-available';
}

type AirplayAvailabilityCallback = (isAirplayAvailable: boolean) => void;
type ChromecastStateCallback = (state: cast.framework.CastState) => void;

interface AirplayAudioElement extends HTMLAudioElement {
  webkitShowPlaybackTargetPicker: () => void;
}

const throwError = () => {
  throw new Error('Audio.init not called!');
};

export default class AudioUtils {
  private static playbackInstance: Howl | null;
  private static currentEpisode: IEpisode | null = null;
  private static playbackId: number | undefined = undefined;
  private static airplayAvailabilityListener: AirplayAvailabilityCallback | null = null;
  private static chromecastStateListener: ChromecastStateCallback | null = null;
  public static isAirplayEnabled: boolean = false;
  public static isChromecastEnabled: boolean = false;

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
    AudioUtils.isAirplayEnabled = e.availability === 'available';
    AudioUtils.airplayAvailabilityListener?.(AudioUtils.isAirplayEnabled);
  }

  public static addAirplayAvailabilityListener(listener: AirplayAvailabilityCallback) {
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

  public static getChromecastState() {
    const context = cast.framework.CastContext.getInstance();
    return context.getCastState();
  }

  public static onChromecastEnabled() {
    AudioUtils.isChromecastEnabled = true;
  }

  private static chromecastStateChangeListener(event: cast.framework.CastStateEventData) {
    AudioUtils.chromecastStateListener?.(event.castState);
  }

  public static addChromecastStateListener(listener: ChromecastStateCallback) {
    AudioUtils.chromecastStateListener = listener;
    const context = cast.framework.CastContext.getInstance();
    context.addEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      AudioUtils.chromecastStateChangeListener,
    );
  }

  public static removeChromecastStateListener() {
    AudioUtils.chromecastStateListener = null;
    const context = cast.framework.CastContext.getInstance();
    context.removeEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      AudioUtils.chromecastStateChangeListener,
    );
  }

  public static async playEpisodeOnChromecast() {
    const context = cast.framework.CastContext.getInstance();
    let session = context.getCurrentSession();
    if (!session) {
      try {
        await context.requestSession();
        session = context.getCurrentSession();
      } catch (err) {
        console.error('Error requesting session', err);
      }
    }
    if (!session || !AudioUtils.currentEpisode) return;

    const mediaInfo = new chrome.cast.media.MediaInfo(
      AudioUtils.currentEpisode.file.url,
      AudioUtils.currentEpisode.file.type,
    );
    const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
    metadata.artist = AudioUtils.currentEpisode.author || '';
    metadata.songName = AudioUtils.currentEpisode.title;
    metadata.title = AudioUtils.currentEpisode.title;
    if (AudioUtils.currentEpisode.published) {
      metadata.releaseDate = new Date(AudioUtils.currentEpisode.published).toISOString();
    }
    metadata.images = [
      new chrome.cast.Image(
        AudioUtils.currentEpisode.episodeArt || AudioUtils.currentEpisode.cover,
      ),
    ];
    mediaInfo.metadata = metadata;
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    try {
      await session.loadMedia(request);
    } catch (err) {
      console.error('Error loading media', err);
    }
  }

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
    AudioUtils.currentEpisode = episode;
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
        AudioUtils.currentEpisode = null;
        AudioUtils.removeAirplayAvailabilityListener();
        AudioUtils.callbacks.stopEpisode();
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
    AudioUtils.currentEpisode = null;
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

  public static seekBackward() {
    AudioUtils.seekBy(SEEK_DELTA * -1);
  }

  public static seekForward() {
    AudioUtils.seekBy(SEEK_DELTA);
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

  public static changeRate(rate: number) {
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
const SEEK_DELTA = 10;

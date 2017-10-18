/**
 * Howler player
 */

import { Howl } from 'howler';

let globalHowl: Howl;

interface IAudioCallbacks {
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  stopEpisode();
}

const throwErr = () => {
  throw new Error('Audio.init not called!');
};

class Audio {
  public static callbacks: IAudioCallbacks = {
    seekUpdate: throwErr,
    setBuffer: throwErr,
    stopEpisode: throwErr,
  };

  public static init(callbacks: IAudioCallbacks) {
    Audio.callbacks = callbacks;
  }

  public static play(episode: App.IEpisode) {
    if (globalHowl) {
      Audio.stop();
    }
    globalHowl = new Howl({
      src: [episode.file.url],
      html5: true,
      autoplay: true,
      onload() {
        Audio.callbacks.setBuffer(false);
      },
      onplay() {
        const updateSeek = () =>
          requestAnimationFrame(() => {
            const seekPosition = globalHowl.seek() as number;

            Audio.callbacks.seekUpdate(seekPosition, globalHowl.duration());

            if (globalHowl.playing()) {
              setTimeout(updateSeek, 500);
            }
          });
        updateSeek();
      },
      onend() {
        Audio.callbacks.stopEpisode();
      },
    });
  }

  public static pause() {
    globalHowl && globalHowl.pause();
  }

  public static resume() {
    globalHowl && globalHowl.play();
  }

  public static stop() {
    globalHowl && globalHowl.stop();
  }

  public static skipTo(episode: App.IEpisode) {
    Audio.pause();
    Audio.play(episode);
  }

  public static seekTo(position: number) {
    globalHowl && globalHowl.seek(position);
  }
}

export default Audio;

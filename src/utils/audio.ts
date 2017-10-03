/**
 * Howler player
 */

import {
  Howl,
} from 'howler';

let globalHowl: Howl;

interface AudioCallbacks {
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  stopEpisode();
}

const noop = () => console.log('Audio.init not called!');

class Audio {
  public static callbacks: AudioCallbacks = {
    seekUpdate: noop,
    setBuffer: noop,
    stopEpisode: noop,
  };

  public static init(callbacks: AudioCallbacks) {
    Audio.callbacks = callbacks;
  }

  public static play(episode: App.Episode) {
    if (globalHowl) {
      Audio.stop();
    }
    globalHowl = new Howl({
      src: [episode.file.url],
      autoplay: true,
      html5: true,
      onload() {
        Audio.callbacks.setBuffer(false);
      },
      onplay() {
        const updateSeek = () => requestAnimationFrame(() => {
          const seekPosition = globalHowl.seek() as number;

          Audio.callbacks.seekUpdate(
            seekPosition,
            globalHowl.duration(),
          );

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

  public static skipTo(episode: App.Episode) {
    Audio.pause();
    Audio.play(episode);
  }

  public static seekTo(position: number) {
    globalHowl && globalHowl.seek(position);
  }
}

export default Audio;

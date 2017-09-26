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
  static callbacks: AudioCallbacks = {
    seekUpdate: noop,
    setBuffer: noop,
    stopEpisode: noop,
  };

  static init(callbacks: AudioCallbacks) {
    Audio.callbacks = callbacks;
  }

  static play(episode: App.Episode) {
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
            globalHowl.duration()
          );

          if (globalHowl.playing()) {
            setTimeout(updateSeek, 750);
          }
        });
        updateSeek();
      },
      onend() {
        Audio.callbacks.stopEpisode();
      }
    });
  }

  static pause() {
    globalHowl && globalHowl.pause();
  }

  static resume() {
    globalHowl && globalHowl.play();
  }

  static stop() {
    globalHowl && globalHowl.stop();
  }

  static skipTo(episode: App.Episode) {
    Audio.pause();
    Audio.play(episode);
  }

  static seekTo(position: number) {
    globalHowl && globalHowl.seek(position);
  }
}

export default Audio;

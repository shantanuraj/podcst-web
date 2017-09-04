/**
 * Howler player
 */

import {
  Howl,
} from 'howler';

let globalHowl: Howl;

const Audio = {
  play(episode: App.Episode) {
    if (globalHowl) {
      Audio.pause();
    }
    globalHowl = new Howl({
      src: [episode.file.url],
      autoplay: true,
      onload() {
        console.log('Loaded audio');
      }
    });
  },
  pause() {
    globalHowl && globalHowl.pause();
  },
  resume() {
    globalHowl && globalHowl.play();
  },
  stop() {
    globalHowl && globalHowl.stop();
  },
  skipTo(episode: App.Episode) {
    Audio.pause();
    Audio.play(episode);
  },
}

export default Audio;

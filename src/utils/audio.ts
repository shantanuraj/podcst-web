/**
 * Howler player
 */

import {
  Howl,
} from 'howler';

import {
  seekUpdate,
  stopEpisode,
} from '../stores/player';

import {
  store,
} from '../index';

let globalHowl: Howl;

const Audio = {
  play(episode: App.Episode) {
    if (globalHowl) {
      Audio.stop();
    }
    globalHowl = new Howl({
      src: [episode.file.url],
      autoplay: true,
      html5: true,
      onload() {
        console.log('Loaded audio');
      },
      onplay() {
        const updateSeek = () => requestAnimationFrame(() => {
          const seekPosition = globalHowl.seek() as number;

          store.dispatch(seekUpdate(seekPosition, globalHowl.duration()));

          if (globalHowl.playing()) {
            setTimeout(updateSeek, 750);
          }
        });
        updateSeek();
      },
      onend() {
        store.dispatch(stopEpisode());
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
  seekTo(position: number) {
    globalHowl && globalHowl.seek(position);
  },
}

export default Audio;

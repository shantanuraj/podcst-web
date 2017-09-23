/**
 * Player component
 */

import {
  Observable,
} from 'rxjs/Observable';

import {
  Subscription,
} from 'rxjs/Subscription';

import {
  h,
  Component,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

import {
  PlayerState,
} from '../stores/player';

import PlayerInfo from './PlayerInfo';
import Seekbar from './Seekbar';

const player = style(
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    position: 'fixed',
    bottom: 0,
    left: 0,
    height: '64px',
    width: '100%',
    zIndex: 500,
    fontSize: 20,
    color: 'white',
    boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
  },
  media({ maxWidth: 600 }, {
    height: '128px',
    flexDirection: 'column-reverse',
    alignItems: 'stretch',
  }),
);

interface PlayerProps extends PlayerState {
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
  onSeek: (seekPosition: number, duration: number) => void;
}

const Key: KeyboardShortcutsMap = {
  32: 'play',
  37: 'prev',
  80: 'prev',
  39: 'next',
  78: 'next',
}

const ignoreKeyboardSelector = 'header *';

class Player extends Component<PlayerProps, any> {

  private sub: Subscription | null = null;

  componentDidMount() {
    this.subscribe();
  }

  componentWillUnmount() {
    this.unsubscribe();
  }

  componentDidUpdate() {
    const {
      state
    } = this.props;

    if (state === 'stopped') {
      this.unsubscribe();
    } else if (this.sub === null) {
      this.subscribe();
    }
  }

  subscribe() {
    this.sub = Observable.fromEvent(window, 'keydown')
      .filter(({
        keyCode,
        target,
      }: KeyboardEvent) =>
        !(target as HTMLElement).matches(ignoreKeyboardSelector) &&
        !!Object.keys(Key).find(key => parseInt(key) === keyCode)
      )
      .subscribe(this.keyboardControls);
  }

  unsubscribe() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  keyboardControls = (e: KeyboardEvent) => {
    const {
      preventDefault,
      keyCode,
    } = e;

    preventDefault.call(e);
    const {
      state,
      pause,
      resume,
      skipToNext,
      skipToPrev,
    } = this.props;

    switch(Key[keyCode]) {
      case 'play': {
        state === 'paused' ?
          resume() : pause();
        break;
      }
      case 'next': {
        skipToNext();
        break;
      }
      case 'prev': {
        skipToPrev();
        break;
      }
    }

    return false;
  }

  render({
    duration,
    currentEpisode,
    pause,
    queue,
    resume,
    seekPosition,
    state,
    onSeek,
  }: PlayerProps) {
    const episode = queue[currentEpisode];

    if (state === 'stopped' || !episode) {
      return null;
    }

    const duration_ = duration || episode.duration || 0;

    return (
      <div class={player}>
        <PlayerInfo
          episode={episode}
          pause={pause}
          resume={resume}
          state={state}
        />
        <Seekbar
          onSeek={onSeek}
          duration={duration_}
          seekPosition={seekPosition}
        />
      </div>
    );
  }
}

export default Player;

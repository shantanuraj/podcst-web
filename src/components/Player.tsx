/**
 * Player component
 */

import {
  h,
  Component,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  PlayerState,
} from '../stores/player';

import Icon from '../svg/Icon';
import Seekbar from './Seekbar';

const player = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  backgroundColor: '#292929',
  position: 'fixed',
  bottom: 0,
  left: 0,
  height: '64px',
  width: '100%',
  zIndex: 500,
  paddingLeft: 16,
  fontSize: 20,
  color: 'white',
  boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
});

const episodeInfo = style({
  display: 'flex',
  height: '100%',
  flexDirection: 'column',
  justifyContent: 'space-evenly' as any,
  marginRight: '16px',
  $nest: {
    '&>*': {
      fontSize: '14px',
      fontWeight: 'bold',
    },
    '&>*:last-child': {
      fontSize: '10px',
      fontWeight: 'lighter',
    },
  },
});

interface PlayerProps extends PlayerState {
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
  onSeek: (seekPosition: number, duration: number) => void;
}

const episodeImage = (image: string) => style({
  backgroundImage: `url(${image})`,
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  height: 'inherit',
  width: 'inherit',
  maxWidth: '64px',
  marginRight: '16px',
});

const Key: KeyboardShortcutsMap = {
  32: 'play',
  37: 'prev',
  80: 'prev',
  39: 'next',
  78: 'next',
}

const ignoreKeyboardSelector = 'header *';

class Player extends Component<PlayerProps, any> {

  componentDidMount() {
    window.addEventListener('keydown', this.keyboardControls);
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.keyboardControls);
  }

  keyboardControls = (e: KeyboardEvent) => {
    const {
      keyCode,
      target,
    } = e;

    if (
      (target as HTMLElement).matches(ignoreKeyboardSelector) ||
      !Object.keys(Key).find(key => parseInt(key) === keyCode)
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

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

    const {
      author,
      cover,
      episodeArt,
      title,
    } = episode;

    const duration_ = duration || episode.duration || 0;

    return (
      <div class={player}>
        <Icon
          onClick={state === 'playing' ? pause : resume }
          icon={state === 'playing' ? 'pause' : 'play'}
        />
        <div
          class={episodeImage(episodeArt || cover as string)}
          role="img"
          aria-label={`${title} episode art`}
        />
        <div class={episodeInfo}>
          <p>
            {title}
          </p>
          <p>
            {author}
          </p>
        </div>
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

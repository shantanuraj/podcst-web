/**
 * Player component
 */

import {
  h,
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

const Player = ({
  duration,
  currentEpisode,
  pause,
  queue,
  resume,
  seekPosition,
  state,
  onSeek,
}: PlayerProps) => {
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
};

export default Player;

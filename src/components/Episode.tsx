/**
 * Episode view
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  monthName,
} from '../utils';

const episodeContainer = style({
  paddingTop: 16,
  paddingBottom: 16,
  paddingLeft: 32,
  paddingRight: 32,
  $nest: {
    '&:nth-child(even)': {
      backgroundColor: '#333',
    },
  },
});

const episodeRow = style({
  display: 'flex',
  justifyContent: 'space-between',
});

const infoContainer = style({
  display: 'flex',
  alignItems: 'center',
});

const subContainer = style({
  marginRight: 16,
  color: '#ccc',
});

const playInfo = style({
  display: 'flex',
  alignItems: 'center',
});

const playButton = style({
  display: 'inline-block',
  minWidth: '80px',
  borderRadius: '3px',
  padding: '8px',
  background: 'transparent',
  color: 'white',
  border: '2px solid #82ffb5',
  $nest: {
    '&:hover, &:focus, &:active, &[data-is-playing], &[data-is-paused]': {
      outline: 0,
      backgroundColor: '#82ffb5',
      color: '#292929',
    },
  },
});

interface EpisodeProps {
  episode: App.Episode;
  currentEpisode: App.Episode | null;
  state: EpisodePlayerState;
  play: (episode: App.Episode) => void;
  resume: () => void;
  pause: () => void;
}

const renderButton = ({
  currentEpisode,
  episode,
  play,
  pause,
  resume,
  state,
}: EpisodeProps) => {
  const isCurrent = currentEpisode === episode;
  const isPlaying = isCurrent && state === 'playing';
  const isPaused  = isCurrent && state === 'paused';

  const play_ = () => play(episode);

  const handler = isPlaying ? pause : (isPaused ? resume : play_);
  const text = isPlaying ? 'Pause' : (isPaused ? 'Resume' : 'Play');

  return (
    <button
      class={playButton}
      data-is-playing={isPlaying}
      data-is-paused={isPaused}
      onClick={handler}
    >
      {text}
    </button>
  );
}

const Episode = (props: EpisodeProps) => {
  const {
    episode,
  } = props;

  const {
    title,
    published,
    duration,
  } = episode;

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = monthName(pub.getMonth());
  const episodeLength = duration ? `${Math.floor(duration / 60)} mins` : '';

  return (
    <div class={episodeContainer}>
      <div class={episodeRow}>
        <div class={infoContainer}>
          <div class={subContainer}>
            {`${month} ${day}`}
          </div>
          <div>
            {title}
          </div>
        </div>
        <div class={playInfo}>
          <div class={subContainer}>
            {episodeLength}
          </div>
          {renderButton(props)}
        </div>
      </div>
    </div>
  );
};

export default Episode;

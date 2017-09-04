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
  padding: 16,
});

const lineBreak = style({
  marginTop: 16,
  width: 'auto',
  height: '1px',
  borderBottom: '1px #eaeaea solid',
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

const playButton = (isPlaying: boolean) => style({
  display: 'inline-block',
  minWidth: '80px',
  borderRadius: '3px',
  padding: '8px',
  background: isPlaying ? '#82ffb5' : 'transparent',
  color: isPlaying ? '#292929' : 'white',
  border: '2px solid #82ffb5',
  $nest: {
    '& :active, :focus': {
      outline: 0,
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

  if (isPlaying) {
    return (
      <button onClick={pause} class={playButton(isPlaying)}>
        Pause
      </button>
    );
  }
  return (
    <button onClick={isPaused ? resume : play_} class={playButton(isPlaying)}>
      {isPaused ? 'Resume' : 'Play'}
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
      <div class={lineBreak} />
    </div>
  );
};

export default Episode;
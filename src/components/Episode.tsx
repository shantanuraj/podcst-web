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

const episodeContainer = (theme: App.Theme) => style({
  paddingTop: 16,
  paddingBottom: 16,
  paddingLeft: 32,
  paddingRight: 32,
  $nest: {
    '&:nth-child(even)': {
      backgroundColor: theme.backgroundLight,
    },
  },
});

const episodeRow = style({
  display: 'flex',
  justifyContent: 'space-between',
});

const container = style({
  display: 'flex',
  alignItems: 'center',
});

const episodeTitle = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
});

const subContainer = (theme: App.Theme) => style({
  marginRight: 16,
  color: theme.subTitle,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  $nest: {
    '& > p': {
      margin: 4,
    },
  },
});

const playButton = (theme: App.Theme) => style({
  display: 'inline-block',
  minWidth: '80px',
  borderRadius: '3px',
  padding: '8px',
  background: 'transparent',
  color: theme.text,
  border: `2px solid ${theme.accent}`,
  $nest: {
    '&:hover, &:focus, &:active, &[data-is-playing], &[data-is-paused]': {
      outline: 0,
      backgroundColor: theme.accent,
      color: theme.background,
    },
  },
});

interface EpisodeProps {
  episode: App.Episode;
  currentEpisode: App.Episode | null;
  state: EpisodePlayerState;
  theme: App.Theme;
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
  theme,
}: EpisodeProps) => {
  const isCurrent = currentEpisode === episode;
  const isPlaying = isCurrent && state === 'playing';
  const isPaused  = isCurrent && state === 'paused';

  const play_ = () => play(episode);

  const handler = isPlaying ? pause : (isPaused ? resume : play_);
  const text = isPlaying ? 'Pause' : (isPaused ? 'Resume' : 'Play');

  return (
    <button
      class={playButton(theme)}
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
    theme,
  } = props;

  const {
    title,
    published,
    duration,
  } = episode;

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = monthName(pub.getMonth());
  const minutes = Math.floor((duration || 0) / 60);
  const minutesSuffix = `min${minutes > 0 ? 's' : ''}`;
  const subContainerTheme = subContainer(theme);

  return (
    <div class={episodeContainer(theme)}>
      <div class={episodeRow}>
        <div class={container}>
          <div class={subContainerTheme}>
            <p>{month}</p>
            <p>{day}</p>
          </div>
        </div>
        <div class={episodeTitle}>
          {title}
        </div>
        <div class={container}>
          <div class={subContainerTheme}>
            <p>{minutes}</p>
            <p>{minutesSuffix}</p>
          </div>
          {renderButton(props)}
        </div>
      </div>
    </div>
  );
};

export default Episode;

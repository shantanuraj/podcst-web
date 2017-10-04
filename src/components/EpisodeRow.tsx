/**
 * Episode view
 */

import {
  h,
} from 'preact';

import {
  Link,
} from 'preact-router';

import {
  media,
  style,
} from 'typestyle';

import {
  monthName,
} from '../utils';

import {
  IEpisodeInfo,
} from '../stores/player';

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
}, media({ maxWidth: 600 }, { padding: 16 } ));

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

interface IEpisodeRowProps {
  episode: App.Episode;
  currentEpisode: App.Episode | null;
  feed: string;
  state: EpisodePlayerState;
  theme: App.Theme;
  play: (episode: IEpisodeInfo) => void;
  resume: () => void;
  pause: () => void;
}

const renderButton = ({
  currentEpisode,
  feed,
  episode,
  play,
  pause,
  resume,
  state,
  theme,
}: IEpisodeRowProps) => {
  const isCurrent = currentEpisode === episode;
  const isPlaying = isCurrent && state === 'playing';
  const isPaused  = isCurrent && state === 'paused';

  const playEpisode = () => play({...episode, feed});

  const handler = isPlaying ? pause : (isPaused ? resume : playEpisode);
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
};

const EpisodeRow = (props: IEpisodeRowProps) => {
  const {
    episode,
    feed,
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
        <Link
          class={episodeTitle}
          href={`/episode?feed=${encodeURIComponent(feed)}&title=${encodeURIComponent(title)}`}
        >
          {title}
        </Link>
        <div class={subContainerTheme}>
          <p>{minutes || ''}</p>
          <p>{minutes ? minutesSuffix : ''}</p>
        </div>
        <div class={container}>
          {renderButton(props)}
        </div>
      </div>
    </div>
  );
};

export default EpisodeRow;

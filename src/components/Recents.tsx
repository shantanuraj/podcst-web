/**
 * Recents component
 */

import { h } from 'preact';

import { style } from 'typestyle';

import EpisodeRow from './EpisodeRow';

const container = style({
  padding: 0,
  margin: 0,
});

interface IRecentsProps {
  currentEpisode: App.IEpisodeInfo | null;
  episodes: App.IEpisodeInfo[];
  theme: App.ITheme;
  playEpisode: (episode: App.IEpisodeInfo) => void;
}

const recentRow = (
  currentEpisode: App.IEpisodeInfo | null,
  playEpisode: (episode: App.IEpisodeInfo) => void,
  theme: App.ITheme,
) => (episode: App.IEpisodeInfo) => (
  <EpisodeRow
    isCurrentEpisode={currentEpisode === episode}
    episode={episode}
    play={() => playEpisode(episode)}
    theme={theme}
  />
);

const Recents = ({ currentEpisode, episodes, playEpisode, theme }: IRecentsProps) => {
  const RecentRow = recentRow(currentEpisode, playEpisode, theme);
  return (
    <div>
      <ul class={container}>{episodes.map(RecentRow)}</ul>
    </div>
  );
};

export default Recents;

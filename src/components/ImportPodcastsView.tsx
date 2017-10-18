/**
 * Import Podcasts component
 */

import { h } from 'preact';

import { style } from 'typestyle';

import ConnectedImportPodcasts from '../containers/ConnectedImportPodcasts';

const container = style({
  height: '100%',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const importButton = (theme: App.ITheme) =>
  style({
    background: 'transparent',
    border: `2px solid ${theme.accent}`,
    borderRadius: '3px',
    color: theme.text,
    display: 'inline-block',
    minWidth: '200px',
    padding: '8px',
    $nest: {
      '& input': {
        display: 'none',
      },
    },
  });

interface IImportPodcastsViewProps {
  theme: App.ITheme;
}

const ImportPodcastsView = ({ theme }: IImportPodcastsViewProps) => (
  <div class={container}>
    <button class={importButton(theme)}>
      <ConnectedImportPodcasts />
    </button>
  </div>
);

export default ImportPodcastsView;

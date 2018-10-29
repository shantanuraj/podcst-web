/**
 * Import Podcasts component
 */

import * as React from 'react';

import { style } from 'typestyle';

import { App } from '../typings';

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
  <div className={container}>
    <button className={importButton(theme)}>
      <ConnectedImportPodcasts />
    </button>
  </div>
);

export default ImportPodcastsView;

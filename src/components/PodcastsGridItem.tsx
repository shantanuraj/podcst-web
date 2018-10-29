/**
 * Podcasts Grid Item
 */

import * as React from 'react';

import { Link } from 'react-router-dom';

import { style } from 'typestyle';

import { placeholderURL } from '../utils';

import { App } from '../typings';

const gridContainer = (mode: App.ThemeMode) =>
  style({
    backgroundImage: placeholderURL(mode),
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 100,
  });

const gridItem = (cover: string) =>
  style({
    height: '200px',
    padding: '8px',
    color: 'white',
    fontSize: '12px',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    background: `
    linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0%,
      rgba(0, 0, 0, 0) 12%,
      rgba(0, 0, 0, 0) 23%,
      rgba(0, 0, 0, 0) 34%,
      rgba(0, 0, 0, 0) 50%,
      rgba(0, 0, 0, 0.2) 60%,
      rgba(0, 0, 0, 0.4) 76%,
      rgba(17, 17, 17, 0.5) 88%,
      rgba(28, 28, 28, 0.5) 94%,
      rgba(43, 43, 43, 0.6) 95%,
      rgba(19, 19, 19, 0.8) 100%
    ),
    url(${cover});`,
  });

const podcastTitle = style({
  fontSize: '14px',
  fontWeight: 'bold',
  marginBottom: '8px',
});

const podcastAuthor = style({
  fontWeight: 'lighter',
});

interface IPodcastsGridItemProps {
  podcast: App.RenderablePodcast;
  mode: App.ThemeMode;
}

const PodcastsGridItem = ({ podcast, mode }: IPodcastsGridItemProps) => {
  const { author, feed, title } = podcast;
  return (
    <Link className={gridContainer(mode)} href={`/episodes?feed=${feed}`}>
      <div role="img" aria-label={`${title} by ${author}`} className={gridItem(podcast.cover)}>
        <div>
          <div className={podcastTitle}>{title}</div>
          <div className={podcastAuthor}>{author}</div>
        </div>
      </div>
    </Link>
  );
};

export default PodcastsGridItem;

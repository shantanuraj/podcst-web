/**
 * Recents component
 */

import { h } from 'preact';

import { style } from 'typestyle';

interface IRecentsProps {
  episodes: App.IEpisodeInfo[];
}

const RecentRow = ({ author, title }: App.IEpisodeInfo) => (
  <li>
    {author} - {title}
  </li>
);

const Recents = ({ episodes }: IRecentsProps) => (
  <div class={style({ color: 'white' })}>
    <ul>{episodes.map(RecentRow)}</ul>
  </div>
);

export default Recents;

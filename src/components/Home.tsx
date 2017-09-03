/**
 * Home component
 */

import {
  h,
} from 'preact';

import PodcastsGrid from './PodcastsGrid';

interface HomeProps {
  path: string;
}

const Home = (_props: HomeProps) => (
  <div>
    <PodcastsGrid />
  </div>
);

export default Home;

/**
 * Home component
 */

import {
  h,
} from 'preact';

interface HomeProps {
  path: string;
}

import ImportPodcasts from './ImportPodcasts';

const Home = (_props: HomeProps) => (
  <ImportPodcasts />
);

export default Home;

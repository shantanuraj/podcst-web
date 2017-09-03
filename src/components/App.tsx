/**
 * App component
 */

import {
  h,
} from 'preact';

import Router from 'preact-router';

import ConnectedLoader from '../containers/ConnectedLoader';
import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';
import ConnectedEpisodes from '../containers/ConnectedEpisodes';

import Home from './Home';
import Toolbar from './Toolbar';

const App = () => (
  <div>
    <Toolbar />
    <ConnectedLoader />
    <div style={{ paddingTop: 64 }}>
      <Router>
        <Home path="/" />
        <ConnectedPodcastsGrid path="/feed/:feed" />
        <ConnectedEpisodes path="/episodes" />
      </Router>
    </div>
  </div>
);

export default App;

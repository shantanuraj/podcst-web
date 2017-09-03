/**
 * App component
 */

import {
  h,
} from 'preact';
import {
  style,
} from 'typestyle';
import Router from 'preact-router';

import ConnectedLoader from '../containers/ConnectedLoader';
import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';
import ConnectedEpisodes from '../containers/ConnectedEpisodes';

import Home from './Home';
import Toolbar from './Toolbar';

const normalize = style({
  height: '100%',
  width: '100%',
});

const App = () => (
  <div class={normalize}>
    <Toolbar />
    <ConnectedLoader />
    <div class={normalize} style={{ paddingTop: 64 }}>
      <Router>
        <Home path="/" />
        <ConnectedPodcastsGrid path="/feed/:feed" />
        <ConnectedEpisodes path="/episodes" />
      </Router>
    </div>
  </div>
);

export default App;

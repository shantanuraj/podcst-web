/**
 * App component
 */

import {
  h,
} from 'preact';

import Router from 'preact-router';

import ConnectedLoader from '../containers/ConnectedLoader';
import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';

import Episodes from './Episodes';

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
        <Episodes path="/episodes" />
      </Router>
    </div>
  </div>
);

export default App;

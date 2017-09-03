/**
 * App component
 */

import {
  h,
} from 'preact';

import Router from 'preact-router';

import ConnectedLoader from '../containers/ConnectedLoader';

import Home from './Home';
import Toolbar from './Toolbar';

const App = () => (
  <div>
    <Toolbar />
    <ConnectedLoader />
    <Router>
      <Home path="/" />
    </Router>
  </div>
);

export default App;

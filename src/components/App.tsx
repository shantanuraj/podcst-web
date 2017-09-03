/**
 * App component
 */

import {
  h,
} from 'preact';
import {
  Provider,
} from 'preact-redux';
import Router from 'preact-router';

import configureStore from '../stores';

import ConnectedLoader from '../containers/ConnectedLoader';

const store = configureStore();

const App = () => (
  <Provider store={store}>
    <ConnectedLoader />
    <Router>
    </Router>
  </Provider>
);

export default App;

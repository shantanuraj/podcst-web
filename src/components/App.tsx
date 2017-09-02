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

const store = configureStore();

const App = () => (
  <Provider store={store}>
    <Router>
    </Router>
  </Provider>
);

export default App;

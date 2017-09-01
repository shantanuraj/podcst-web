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

import {
  WindowEl,
} from './ProtonUI';
import AuthView from '../containers/AuthView';
import TextsView from '../containers/TextsView';

const store = configureStore();

const App = () => (
  <Provider store={store}>
    <WindowEl>
      <Router>
        <AuthView path="/" />
        <TextsView path="/texts/:thread?" />
      </Router>
    </WindowEl>
  </Provider>
);

export default App;

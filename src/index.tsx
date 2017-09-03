/**
 * Root app file
 */

import {
  h,
  render,
} from 'preact';

import {
  Provider,
} from 'preact-redux';

// Patch Rx operators
import './utils/patch_operators';

import configureStore from './stores';

import App from './components/App';

const store = configureStore();

const PodcastApp = () => (
  <Provider store={store}>
    <App />
  </Provider>
);

render(<PodcastApp />, document.body);

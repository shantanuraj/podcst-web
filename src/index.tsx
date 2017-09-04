/**
 * Root app file
 */

if (module.hot) {
  module.hot.accept();
}

import {
  h,
  render,
} from 'preact';

import {
  Provider,
} from 'preact-redux';

// Patch Rx operators
import './utils/patch_operators';
import {
  fixGlobalStyles,
} from './utils/styles';

import configureStore from './stores';

import App from './components/App';

export const store = configureStore();

const PodcastApp = () => (
  <Provider store={store}>
    <App />
  </Provider>
);

fixGlobalStyles();

render(<PodcastApp />, document.body);

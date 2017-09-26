/**
 * Root app file
 */

if (module.hot) {
  require('preact/devtools');
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
  setupMediaSession,
} from './utils/chrome-media-utils';

import configureStore from './stores';

import ConnectedApp from './containers/ConnectedApp';

export const store = configureStore();

const version = process.env.APP_VERSION;

interface PodcastAppProps {
  version: string;
}

const PodcastApp = ({ version }: PodcastAppProps) => (
  <Provider store={store}>
    <ConnectedApp version={version} />
  </Provider>
);

if ('mediaSession' in navigator) {
  setupMediaSession(store);
}

render(<PodcastApp version={version} />, document.body);

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
import ConnectedApp from './containers/ConnectedApp';
import configureStore from './stores';
import './utils/patch_operators';

const store = configureStore();

const version = process.env.APP_VERSION;

interface PodcastAppProps {
  version: string;
}

const PodcastApp = ({ version }: PodcastAppProps) => (
  <Provider store={store}>
    <ConnectedApp version={version} />
  </Provider>
);

render(<PodcastApp version={version} />, document.body);

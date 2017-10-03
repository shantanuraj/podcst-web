/**
 * Root app file
 */

if (module.hot) {
  /* tslint:disable:no-var-requires */
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

const appVersion = process.env.APP_VERSION;

interface IPodcastAppProps {
  version: string;
}

const PodcastApp = ({ version }: IPodcastAppProps) => (
  <Provider store={store}>
    <ConnectedApp version={version} />
  </Provider>
);

render(<PodcastApp version={appVersion} />, document.body);

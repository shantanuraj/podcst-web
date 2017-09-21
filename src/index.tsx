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
  fixGlobalStyles,
} from './utils/styles';

import configureStore from './stores';

import App from './components/App';

export const store = configureStore();

interface PodcastAppProps {
  version: string;
}
const PodcastApp = (_props: PodcastAppProps) => (
  <Provider store={store}>
    <App />
  </Provider>
);

fixGlobalStyles();

const appVersion = process.env.APP_VERSION;

render(<PodcastApp version={appVersion} />, document.body);

console.log(`Initalized Podcst.io version: ${appVersion}`);

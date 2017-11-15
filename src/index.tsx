/**
 * Root app file
 */

import { h, render } from 'preact';

import { Provider } from 'preact-redux';

import { forceRenderStyles } from 'typestyle';

// Patch Rx operators
import './utils/patch_operators';

import ConnectedApp from './containers/ConnectedApp';

import configureStore from './stores';

interface IPodcastAppProps {
  version: string;
}

const init = () => {
  const store = configureStore();
  const appVersion = process.env.APP_VERSION;

  const PodcastApp = ({ version }: IPodcastAppProps) => (
    <Provider store={store}>
      <ConnectedApp version={version} />
    </Provider>
  );

  const mount = document.getElementById('root')!;
  render(<PodcastApp version={appVersion} />, mount, mount.lastElementChild as Element);
  forceRenderStyles();
};

if (module.hot) {
  // tslint:disable:no-var-requires
  require('preact/devtools');
  module.hot.accept();
}

init();

/**
 * Root app file
 */

import { h, render } from 'preact';

import { Provider } from 'preact-redux';

// Patch Rx operators
import ConnectedApp from './containers/ConnectedApp';
import configureStore from './stores';
import './utils/patch_operators';

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

  const mount = document.getElementById('root') as HTMLElement;
  render(<PodcastApp version={appVersion} />, mount, mount.lastElementChild as Element);
};

if (module.hot) {
  // tslint:disable:no-var-requires
  require('preact/devtools');
  module.hot.accept();
}

init();

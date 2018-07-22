/**
 * Root app file
 */

import * as React from 'react';

import { render } from 'react-dom';

import { Provider } from 'react-redux';

import { forceRenderStyles } from 'typestyle';

import { fixGlobalStyles } from './utils/styles';

import ConnectedApp from './containers/ConnectedApp';

import configureStore from './stores';
import { IPodcastWebpackModule } from './typings';

interface IPodcastAppProps {
  version: string;
}

const init = () => {
  const store = configureStore();
  const appVersion = process.env.APP_VERSION!;

  const { theme } = store.getState().app;
  fixGlobalStyles(theme);

  const PodcastApp = ({ version }: IPodcastAppProps) => (
    <Provider store={store}>
      <ConnectedApp version={version} />
    </Provider>
  );

  const mount = document.getElementById('root')!;

  render(<PodcastApp version={appVersion} />, mount);
  forceRenderStyles();
};

if ((module as any as IPodcastWebpackModule).hot) {
  (module as any as IPodcastWebpackModule).hot!.accept();
}

init();

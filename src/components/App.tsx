/**
 * App component
 */

import * as React from 'react';

import { classes, media, style } from 'typestyle';

import { Router } from 'react-router';

import { Route, Switch } from 'react-router-dom';

import { history } from '../utils/history';

import { normalizeEl } from '../utils/styles';

import Audio from '../utils/audio';

import { getTitle } from '../utils/route-titles';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT, TOOLBAR_HEIGHT } from '../utils/constants';

import IndexRedirect from '../components/IndexRedirect';

import ConnectedDrawer from '../containers/ConnectedDrawer';

import ConnectedEpisodeInfo from '../containers/ConnectedEpisodeInfo';

import ConnectedEpisodes from '../containers/ConnectedEpisodes';

import ConnectedLoader from '../containers/ConnectedLoader';

import ConnectedPlayer from '../containers/ConnectedPlayer';

import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';

import ConnectedRecents from '../containers/ConnectedRecents';

import ConnectedSettings from '../containers/ConnectedSettings';

import ConnectedSubscriptions from '../containers/ConnectedSubscriptions';

import ConnectedToast from '../containers/ConnectedToast';

import ConnectedToolbar from '../containers/ConnectedToolbar';

import { App as AppTypes } from '../typings';

const container = style(
  {
    paddingTop: TOOLBAR_HEIGHT,
    $nest: {
      '&[data-is-player-visible="true"]': {
        marginBottom: DESKTOP_PLAYER_HEIGHT,
      },
    },
  },
  media(
    { maxWidth: 600 },
    {
      $nest: {
        '&[data-is-player-visible="true"]': {
          marginBottom: MOBILE_PLAYER_HEIGHT,
        },
      },
    },
  ),
);

const mainContainer = style({
  display: 'flex',
  flexDirection: 'row',
});

interface IAppProps {
  theme: AppTypes.ITheme;
  version: string;
  isPlayerVisible: boolean;
  appInit();
  pauseEpisode();
  resumeEpisode();
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  setTitle(route: string);
  skipToNextEpisode();
  skipToPrevEpisode();
  stopEpisode();
}

class App extends React.PureComponent<IAppProps, never> {
  public componentDidMount() {
    this.props.setTitle(getTitle(location.href));
    Audio.init(this.props);
    this.props.appInit();
    // tslint:disable:no-console
    console.log(`Initalized app version: ${this.props.version}`);
  }

  public render() {
    const { isPlayerVisible, version } = this.props;
    return (
      <Router history={history}>
        <div className={classes(normalizeEl, mainContainer)}>
          <ConnectedToolbar />
          <ConnectedLoader />
          <ConnectedDrawer />
          <main data-is-player-visible={isPlayerVisible} className={classes(normalizeEl, container)}>
            <Switch>
              <Route exact path="/" component={IndexRedirect} />
              <Route
                path="/feed/:feed"
                component={props => <ConnectedPodcastsGrid {...props} mode="feed" feed="top" />}
              />
              <Route exact path="/subs" component={ConnectedSubscriptions} />
              <Route exact path="/episodes" component={ConnectedEpisodes} />
              <Route exact path="/episode" component={ConnectedEpisodeInfo} />
              <Route exact path="/recents" component={ConnectedRecents} />
              <Route exact path="/settings" component={props => <ConnectedSettings {...props} version={version} />} />
            </Switch>
          </main>
          <ConnectedPlayer />
          <ConnectedToast />
        </div>
      </Router>
    );
  }
}

export default App;

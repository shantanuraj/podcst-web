/**
 * App component
 */

import { Component, h } from 'preact';

import { classes, media, style } from 'typestyle';

import { Router, RouterOnChangeArgs } from 'preact-router';

import { fixGlobalStyles, normalizeEl } from '../utils/styles';

import Audio from '../utils/audio';

import { getTitle } from '../utils/route-titles';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT, TOOLBAR_HEIGHT } from '../utils/constants';

import ConnectedDrawer from '../containers/ConnectedDrawer';

import ConnectedEpisodeInfo from '../containers/ConnectedEpisodeInfo';

import ConnectedEpisodes from '../containers/ConnectedEpisodes';

import ConnectedIndexRedirect from '../containers/ConnectedIndexRedirect';

import ConnectedLoader from '../containers/ConnectedLoader';

import ConnectedPlayer from '../containers/ConnectedPlayer';

import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';

import ConnectedRecents from '../containers/ConnectedRecents';

import ConnectedSettings from '../containers/ConnectedSettings';

import ConnectedSubscriptions from '../containers/ConnectedSubscriptions';

import ConnectedToast from '../containers/ConnectedToast';

import ConnectedToolbar from '../containers/ConnectedToolbar';

const container = style(
  {
    paddingTop: TOOLBAR_HEIGHT,
    $nest: {
      '&[data-is-player-visible]': {
        marginBottom: DESKTOP_PLAYER_HEIGHT,
      },
    },
  },
  media(
    { maxWidth: 600 },
    {
      $nest: {
        '&[data-is-player-visible]': {
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
  theme: App.ITheme;
  version: string;
  isPlayerVisible: boolean;
  appInit();
  pauseEpisode();
  resumeEpisode();
  routerNavigate(props: RouterOnChangeArgs);
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  setTitle(route: string);
  skipToNextEpisode();
  skipToPrevEpisode();
  stopEpisode();
}

class App extends Component<IAppProps, never> {
  public componentDidMount() {
    this.props.setTitle(getTitle(location.href));
    Audio.init(this.props);
    this.props.appInit();
    // tslint:disable:no-console
    console.log(`Initalized Podcst.io version: ${this.props.version}`);
  }

  public render() {
    const { isPlayerVisible, routerNavigate, version } = this.props;
    return (
      <div class={classes(normalizeEl, mainContainer)}>
        <ConnectedToolbar />
        <ConnectedLoader />
        <ConnectedDrawer />
        <main data-is-player-visible={isPlayerVisible} class={classes(normalizeEl, container)}>
          <Router onChange={routerNavigate}>
            <ConnectedIndexRedirect path="/" />
            <ConnectedPodcastsGrid mode="feed" path="/feed/:feed" />
            <ConnectedSubscriptions path="/subs" />
            <ConnectedEpisodes path="/episodes" />
            <ConnectedEpisodeInfo path="/episode" />
            <ConnectedRecents path="/recents" />
            <ConnectedSettings version={version} path="/settings" />
          </Router>
        </main>
        <ConnectedPlayer />
        <ConnectedToast />
      </div>
    );
  }
}

export default App;

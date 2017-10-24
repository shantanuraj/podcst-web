/**
 * App component
 */

import { Component, h } from 'preact';

import { classes, style } from 'typestyle';

import { Router, RouterOnChangeArgs } from 'preact-router';

import { fixGlobalStyles, normalizeEl } from '../utils/styles';

import Audio from '../utils/audio';

import { DESKTOP_PLAYER_HEIGHT, TOOLBAR_HEIGHT } from '../utils/constants';

import { IAppState } from '../stores/app';

import ConnectedDrawer from '../containers/ConnectedDrawer';
import ConnectedEpisodeInfo from '../containers/ConnectedEpisodeInfo';
import ConnectedEpisodeInfoModal from '../containers/ConnectedEpisodeInfoModal';
import ConnectedEpisodes from '../containers/ConnectedEpisodes';
import ConnectedIndexRedirect from '../containers/ConnectedIndexRedirect';
import ConnectedLoader from '../containers/ConnectedLoader';
import ConnectedPlayer from '../containers/ConnectedPlayer';
import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';
import ConnectedSettings from '../containers/ConnectedSettings';
import ConnectedSubscriptions from '../containers/ConnectedSubscriptions';
import ConnectedToast from '../containers/ConnectedToast';

import Toolbar from './Toolbar';

const container = style({
  paddingTop: TOOLBAR_HEIGHT,
  marginBottom: DESKTOP_PLAYER_HEIGHT,
});

const mainContainer = style({
  display: 'flex',
  flexDirection: 'row',
});

interface IAppProps extends IAppState {
  version: string;
  appInit();
  pauseEpisode();
  resumeEpisode();
  routerNavigate(props: RouterOnChangeArgs);
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  skipToNextEpisode();
  skipToPrevEpisode();
  stopEpisode();
  toggleDrawer();
}

class App extends Component<IAppProps, never> {
  public componentWillMount() {
    fixGlobalStyles(this.props.theme);
    Audio.init(this.props);
  }

  public componentDidMount() {
    this.props.appInit();
    // tslint:disable:no-console
    console.log(`Initalized Podcst.io version: ${this.props.version}`);
  }

  public render() {
    const { theme, version, routerNavigate, toggleDrawer } = this.props;
    return (
      <div class={classes(normalizeEl, mainContainer)}>
        <Toolbar theme={theme} toggleDrawer={toggleDrawer} />
        <ConnectedLoader />
        <ConnectedDrawer />
        <main class={classes(normalizeEl, container)}>
          <Router onChange={routerNavigate}>
            <ConnectedIndexRedirect path="/" />
            <ConnectedPodcastsGrid mode="feed" path="/feed/:feed" />
            <ConnectedSubscriptions path="/subs" />
            <ConnectedEpisodes path="/episodes" />
            <ConnectedEpisodeInfo path="/episode" />
            <ConnectedSettings version={version} path="/settings" />
          </Router>
        </main>
        <ConnectedPlayer />
        <ConnectedToast />
        <ConnectedEpisodeInfoModal />
      </div>
    );
  }
}

export default App;

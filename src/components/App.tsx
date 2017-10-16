/**
 * App component
 */

import { Component, h } from 'preact';

import { classes, style } from 'typestyle';

import { Router } from 'preact-router';
import Match from 'preact-router/match';

import { fixGlobalStyles, normalizeEl } from '../utils/styles';

import Audio from '../utils/audio';

import { IAppState } from '../stores/app';

import { IMatchProps } from '../stores/router';

import ConnectedEpisodeInfo from '../containers/ConnectedEpisodeInfo';
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
  paddingTop: 64,
  marginBottom: 64,
});

interface IAppProps extends IAppState {
  version: string;
  appInit();
  pauseEpisode();
  resumeEpisode();
  routerNavigate(props: IMatchProps);
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  skipToNextEpisode();
  skipToPrevEpisode();
  stopEpisode();
}

class App extends Component<IAppProps, never> {
  public componentWillMount() {
    fixGlobalStyles(this.props.theme);
    this.setupMediaSession();
    Audio.init(this.props);
  }

  public componentDidMount() {
    this.props.appInit();
    // tslint:disable:no-console
    console.log(`Initalized Podcst.io version: ${this.props.version}`);
  }

  public setupMediaSession() {
    if ('mediaSession' in navigator) {
      const { mediaSession } = navigator as ChromeNavigator;

      const { pauseEpisode, resumeEpisode, skipToNextEpisode, skipToPrevEpisode } = this.props;

      mediaSession.setActionHandler('play', resumeEpisode);
      mediaSession.setActionHandler('pause', pauseEpisode);
      mediaSession.setActionHandler('previoustrack', skipToPrevEpisode);
      mediaSession.setActionHandler('nexttrack', skipToNextEpisode);
    }
  }

  public render() {
    const { theme, version, routerNavigate } = this.props;
    return (
      <div class={normalizeEl}>
        <Toolbar theme={theme} />
        <ConnectedLoader theme={theme} />
        <main class={classes(normalizeEl, container)}>
          <Router>
            <ConnectedIndexRedirect path="/" />
            <ConnectedPodcastsGrid mode="feed" path="/feed/:feed" />
            <ConnectedSubscriptions path="/subs" />
            <ConnectedEpisodes path="/episodes" />
            <ConnectedEpisodeInfo path="/episode" />
            <ConnectedSettings version={version} path="/settings" />
          </Router>
        </main>
        <ConnectedPlayer theme={theme} />
        <ConnectedToast />
        <Match>{routerNavigate}</Match>
      </div>
    );
  }
}

export default App;

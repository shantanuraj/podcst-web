/**
 * App component
 */

import {
  h,
  Component,
} from 'preact';

import {
  classes,
  style,
} from 'typestyle';

import Router from 'preact-router';

import {
  normalizeEl,
  fixGlobalStyles,
} from '../utils/styles';

import Audio from '../utils/audio';

import {
  AppState,
} from '../stores/app';

import ConnectedLoader from '../containers/ConnectedLoader';
import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';
import ConnectedEpisodes from '../containers/ConnectedEpisodes';
import ConnectedEpisodeInfo from '../containers/ConnectedEpisodeInfo';
import ConnectedHome from '../containers/ConnectedHome';
import ConnectedPlayer from '../containers/ConnectedPlayer';
import ConnectedSettings from '../containers/ConnectedSettings';

import Toolbar from './Toolbar';

const container = style({
  paddingTop: 64,
  marginBottom: 64,
});

interface AppProps extends AppState {
  version: string;
  appInit();
  pauseEpisode();
  resumeEpisode();
  seekUpdate(seekPosition: number, duration: number);
  setBuffer(buffering: boolean);
  skipToNextEpisode();
  skipToPrevEpisode();
  stopEpisode();
}

class App extends Component<AppProps, never> {
  componentWillMount() {
    fixGlobalStyles(this.props.theme);
    this.setupMediaSession();
    Audio.init(this.props);
  }

  componentDidMount() {
    this.props.appInit();
    console.log(`Initalized Podcst.io version: ${this.props.version}`);
  }

  setupMediaSession() {
    if ('mediaSession' in navigator) {
      const {
        mediaSession,
      } = navigator as ChromeNavigator;

      const {
        pauseEpisode,
        resumeEpisode,
        skipToNextEpisode,
        skipToPrevEpisode,
      } = this.props;

      mediaSession.setActionHandler('play', resumeEpisode);
      mediaSession.setActionHandler('pause', pauseEpisode);
      mediaSession.setActionHandler('previoustrack', skipToPrevEpisode);
      mediaSession.setActionHandler('nexttrack', skipToNextEpisode);
    }
  }

  render() {
    const { theme, version } = this.props;
    return (
      <div class={normalizeEl}>
        <Toolbar theme={theme} />
        <ConnectedLoader theme={theme} />
        <main
          class={classes(normalizeEl, container)}
        >
          <Router>
            <ConnectedHome path="/" />
            <ConnectedPodcastsGrid mode="feed" path="/feed/:feed" />
            <ConnectedEpisodes path="/episodes" />
            <ConnectedEpisodeInfo path="/episode" />
            <ConnectedSettings version={version} path="/settings" />
          </Router>
        </main>
        <ConnectedPlayer theme={theme} />
      </div>
    );
  }
}

export default App;

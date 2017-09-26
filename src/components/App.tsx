/**
 * App component
 */

import {
  h,
  Component,
} from 'preact';

import Router from 'preact-router';

import {
  normalizeEl,
  fixGlobalStyles,
} from '../utils/styles';

import {
  AppState,
} from '../stores/app';

import ConnectedLoader from '../containers/ConnectedLoader';
import ConnectedPodcastsGrid from '../containers/ConnectedPodcastsGrid';
import ConnectedEpisodes from '../containers/ConnectedEpisodes';
import ConnectedHome from '../containers/ConnectedHome';
import ConnectedPlayer from '../containers/ConnectedPlayer';

import Toolbar from './Toolbar';

interface AppProps extends AppState {
  version: string;
}

class App extends Component<AppProps, never> {
  componentWillMount() {
    fixGlobalStyles(this.props.theme);
  }

  componentDidMount() {
    console.log(`Initalized Podcst.io version: ${this.props.version}`);
  }

  setupMediaSession() {
    if ('mediaSession' in navigator) {

    }
  }

  render() {
    return (
      <div class={normalizeEl}>
        <Toolbar />
        <ConnectedLoader />
        <main
          class={normalizeEl}
          style={{ paddingTop: 64, marginBottom: 64, }}
        >
          <Router>
            <ConnectedHome path="/" />
            <ConnectedPodcastsGrid mode="feed" path="/feed/:feed" />
            <ConnectedEpisodes path="/episodes" />
          </Router>
        </main>
        <ConnectedPlayer />
      </div>
    );
  }
}

export default App;

/**
 * Connected App component
 */

import {
  connect,
} from 'preact-redux';

import {
  bindActionCreators,
  Dispatch,
} from 'redux';

import {
  State,
} from '../stores/root';

import {
  changeTheme,
} from '../stores/app';

import {
  pauseEpisode,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
} from '../stores/player';

import App from '../components/App';

const mapState = (state: State) => state.app;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  changeTheme,
  pauseEpisode,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
}, dispatch);

const ConnectedApp = connect(
  mapState,
  mapDispatch,
)(App);

export default ConnectedApp;

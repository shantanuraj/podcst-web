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
  IState,
} from '../stores/root';

import {
  appInit,
  changeTheme,
} from '../stores/app';

import {
  pauseEpisode,
  resumeEpisode,
  seekUpdate,
  setBuffer,
  skipToNextEpisode,
  skipToPrevEpisode,
  stopEpisode,
} from '../stores/player';

import App from '../components/App';

const mapState = (state: IState) => state.app;

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
  appInit,
  changeTheme,
  pauseEpisode,
  resumeEpisode,
  seekUpdate,
  setBuffer,
  skipToNextEpisode,
  skipToPrevEpisode,
  stopEpisode,
}, dispatch);

const ConnectedApp = connect(
  mapState,
  mapDispatch,
)(App);

export default ConnectedApp;

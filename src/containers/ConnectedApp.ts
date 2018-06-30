/**
 * Connected App component
 */

import { connect } from 'preact-redux';

import { RouterOnChangeArgs } from 'preact-router';

import { IState } from '../stores/root';

import { appInit, setTitle } from '../stores/app';

import {
  pauseEpisode,
  resumeEpisode,
  seekUpdateRequest as seekUpdate,
  setBuffer,
  skipToNextEpisode,
  skipToPrevEpisode,
  stopEpisode,
} from '../stores/player';

import { routerNavigate } from '../stores/router';

import App from '../components/App';

const mapState = ({ app: { theme }, player: { state } }: IState) => ({
  theme,
  isPlayerVisible: state !== 'stopped',
});

const mapDispatch = {
  appInit,
  pauseEpisode,
  resumeEpisode,
  seekUpdate,
  setBuffer,
  setTitle,
  skipToNextEpisode,
  skipToPrevEpisode,
  stopEpisode,
  routerNavigate: ({ url }: RouterOnChangeArgs) => routerNavigate(url),
};

const ConnectedApp = connect(mapState, mapDispatch)(App);

export default ConnectedApp;

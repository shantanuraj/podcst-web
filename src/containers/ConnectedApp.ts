/**
 * Connected App component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { RouterOnChangeArgs } from 'preact-router';

import { IState } from '../stores/root';

import { appInit } from '../stores/app';

import { toggleDrawer } from '../stores/drawer';

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

const mapState = (state: IState) => state.app;

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      appInit,
      pauseEpisode,
      resumeEpisode,
      seekUpdate,
      setBuffer,
      skipToNextEpisode,
      skipToPrevEpisode,
      stopEpisode,
      toggleDrawer,
      routerNavigate: ({ url }: RouterOnChangeArgs) => routerNavigate(url),
    },
    dispatch,
  );

const ConnectedApp = connect(mapState, mapDispatch)(App);

export default ConnectedApp;

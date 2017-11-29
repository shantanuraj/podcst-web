/**
 * Connected Recents component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { recents } from '../utils/recents';

import { playEpisode } from '../stores/player';

import Recents from '../components/recents';

const mapState = (state: IState) => ({
  currentEpisode: state.player.queue[state.player.currentEpisode] || null,
  episodes: recents(state.subscriptions.subs),
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      playEpisode,
    },
    dispatch,
  );

const ConnectedRecents = connect(mapState, mapDispatch)(Recents);

export default ConnectedRecents;

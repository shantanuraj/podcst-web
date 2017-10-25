/**
 * Connected Episodes component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { getEpisodes } from '../stores/podcasts';

import { addSubscription, removeSubscription } from '../stores/subscriptions';

import { playEpisode } from '../stores/player';

import Episodes from '../components/Episodes';

const mapState = (state: IState) => ({
  isPlayerVisible: state.player.state !== 'stopped',
  mode: state.app.mode,
  theme: state.app.theme,
  info: state.podcasts,
  currentEpisode: state.player.queue[state.player.currentEpisode] || null,
  subscriptions: state.subscriptions.subs,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      getEpisodes,
      playEpisode,
      addSubscription,
      removeSubscription,
    },
    dispatch,
  );

const ConnectedEpisodes = connect(mapState, mapDispatch)(Episodes);

export default ConnectedEpisodes;

/**
 * Connected Episodes component
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
  getEpisodes,
} from '../stores/podcasts';

import {
  addSubscription,
  removeSubscription,
} from '../stores/subscriptions';

import {
  pauseEpisode,
  playEpisode,
  resumeEpisode,
} from '../stores/player';

import Episodes from '../components/Episodes';

const mapState = (state: IState) => ({
  theme: state.app.theme,
  info: state.podcasts,
  state: state.player.state,
  currentEpisode: state.player.queue[state.player.currentEpisode] || null,
  subscriptions: state.subscriptions.subs,
});

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
  getEpisodes,
  playEpisode,
  pauseEpisode,
  resumeEpisode,
  addSubscription,
  removeSubscription,
}, dispatch);

const ConnectedEpisodes = connect(
  mapState,
  mapDispatch,
)(Episodes);

export default ConnectedEpisodes;

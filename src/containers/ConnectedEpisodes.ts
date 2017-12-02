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

const mapState = ({
  app: { mode, theme },
  podcasts,
  player: { currentEpisode, queue },
  subscriptions: { subs },
}: IState) => ({
  mode,
  theme,
  info: podcasts,
  currentEpisode: queue[currentEpisode] || null,
  subscriptions: subs,
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

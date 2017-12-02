/**
 * Connected Recents component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { playEpisode } from '../stores/player';

import { recents as recentEpisodes } from '../utils/recents';

import Recents from '../components/recents';

const mapState = ({ app: { theme }, player: { currentEpisode, queue }, subscriptions: { recents, subs } }: IState) => ({
  currentEpisode: queue[currentEpisode] || null,
  episodes: recents && recents.length > 0 ? recents : recentEpisodes(subs),
  theme,
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

/**
 * Connected Loader component
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

import EpisodeInfo from '../components/EpisodeInfo';

const mapState = (state: State) => state;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
}, dispatch);

const ConnectedEpisodeInfo = connect(
  mapState,
  mapDispatch,
)(EpisodeInfo);

export default ConnectedEpisodeInfo;

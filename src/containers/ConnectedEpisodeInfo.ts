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
  IState,
} from '../stores/root';

import EpisodeInfo from '../components/EpisodeInfo';

const mapState = (state: IState) => state;

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
}, dispatch);

const ConnectedEpisodeInfo = connect(
  mapState,
  mapDispatch,
)(EpisodeInfo);

export default ConnectedEpisodeInfo;

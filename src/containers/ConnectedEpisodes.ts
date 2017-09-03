/**
 * Connected Episodes component
 */

import {
  connect,
} from 'preact-redux';

import {
  Dispatch,
  bindActionCreators,
} from 'redux';

import {
  State,
} from '../stores/root';

import {
  getEpisodes,
} from '../stores/podcasts';

import Episodes from '../components/Episodes';

const mapState = (state: State) => ({
  info: state.podcasts,
});

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  getEpisodes,
}, dispatch);

const ConnectedEpisodes = connect(
  mapState,
  mapDispatch,
)(Episodes);

export default ConnectedEpisodes;

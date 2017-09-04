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

import {
  parseOPML,
} from '../stores/subscriptions';

import Home from '../components/Home';

const mapState = (state: State) => state.subscriptions;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  parseOPML,
}, dispatch);

const ConnectedHome = connect(
  mapState,
  mapDispatch,
)(Home);

export default ConnectedHome;

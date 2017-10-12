/**
 * Connected Home component
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
  parseOPML,
} from '../stores/subscriptions';

import Home from '../components/Home';

const mapState = (state: IState) => ({
  ...state.subscriptions,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
  parseOPML,
}, dispatch);

const ConnectedHome = connect(
  mapState,
  mapDispatch,
)(Home);

export default ConnectedHome;

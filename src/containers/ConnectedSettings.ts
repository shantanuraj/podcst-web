/**
 * Connected Settings component
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
  changeTheme,
} from '../stores/app';

import Settings from '../components/Settings';

const mapState = (state: State) => state.app;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  changeTheme,
}, dispatch);

const ConnectedSettings = connect(
  mapState,
  mapDispatch,
)(Settings);

export default ConnectedSettings;

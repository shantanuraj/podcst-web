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
  IState,
} from '../stores/root';

import {
  changeTheme,
} from '../stores/app';

import Settings from '../components/Settings';

const mapState = (state: IState) => state.app;

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
  changeTheme,
}, dispatch);

const ConnectedSettings = connect(
  mapState,
  mapDispatch,
)(Settings);

export default ConnectedSettings;

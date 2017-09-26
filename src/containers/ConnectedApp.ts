/**
 * Connected App component
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
} from '../stores/theme';

import App from '../components/App';

const mapState = (state: State) => state.theme;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  changeTheme,
}, dispatch);

const ConnectedApp = connect(
  mapState,
  mapDispatch,
)(App);

export default ConnectedApp;

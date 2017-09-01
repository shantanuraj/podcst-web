/**
 * AuthView container component
 */

import {
  Dispatch,
  bindActionCreators,
} from 'redux';
import {
  connect,
} from 'preact-redux';

import {
  State,
} from '../stores/root';
import {
  updateCode,
  updateHost,
} from '../stores/auth';
import {
  navigate,
} from '../stores/router';

import AuthView from '../components/AuthView';

const mapState = (state: State) => state.auth;
const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  onHostChange: updateHost,
  onCodeChange: updateCode,
  showTexts: () => navigate('/texts'),
}, dispatch);

const Connected = connect(
  mapState,
  mapDispatch,
)(AuthView);

export default Connected;

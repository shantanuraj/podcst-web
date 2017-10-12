/**
 * Connected Toast component
 */

import {
  connect,
} from 'preact-redux';

import {
  IState,
} from '../stores/root';

import Toast from '../components/Toast';

const mapState = (state: IState) => ({
  ...state.toast,
  theme: state.app.theme,
});

const ConnectedToast = connect(
  mapState,
)(Toast);

export default ConnectedToast;

/**
 * Connected Toast component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import Toast from '../components/Toast';

const mapState = ({ app: { theme }, toast }: IState) => ({
  ...toast,
  theme,
});

const ConnectedToast = connect(mapState)(Toast);

export default ConnectedToast;

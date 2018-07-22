/**
 * Connected Drawer component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import Drawer from '../components/Drawer';

const mapState = ({ app: { theme }, drawer }: IState) => ({
  ...drawer,
  theme,
});

const ConnectedDrawer = connect(mapState)(Drawer);

export default ConnectedDrawer;

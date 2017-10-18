/**
 * Connected Drawer component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import Drawer from '../components/Drawer';

const mapState = (state: IState) => ({
  ...state.drawer,
  theme: state.app.theme,
});

const ConnectedDrawer = connect(mapState)(Drawer);

export default ConnectedDrawer;

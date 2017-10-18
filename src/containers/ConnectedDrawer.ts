/**
 * Connected Drawer component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { closeDrawer } from '../stores/drawer';

import Drawer from '../components/Drawer';

const mapState = (state: IState) => ({
  ...state.drawer,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      closeDrawer,
    },
    dispatch,
  );

const ConnectedDrawer = connect(mapState, mapDispatch)(Drawer);

export default ConnectedDrawer;

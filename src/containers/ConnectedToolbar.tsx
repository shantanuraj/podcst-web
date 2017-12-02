/**
 * Connected Toolbar component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { toggleDrawer } from '../stores/drawer';

import Toolbar from '../components/Toolbar';

const mapState = ({ app: { theme, title } }: IState) => ({
  title,
  theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      toggleDrawer,
    },
    dispatch,
  );

const ConnectedToolbar = connect(mapState, mapDispatch)(Toolbar);

export default ConnectedToolbar;

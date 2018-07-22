/**
 * Connected Toolbar component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { toggleDrawer } from '../stores/drawer';

import Toolbar from '../components/Toolbar';

const mapState = ({ app: { theme, title } }: IState) => ({
  title,
  theme,
});

const mapDispatch = {
  toggleDrawer,
};

const ConnectedToolbar = connect(mapState, mapDispatch)(Toolbar);

export default ConnectedToolbar;

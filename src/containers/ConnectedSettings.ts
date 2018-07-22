/**
 * Connected Settings component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { changeTheme } from '../stores/app';

import Settings from '../components/Settings';

const mapState = (state: IState) => state.app;

const mapDispatch = {
  changeTheme,
};

const ConnectedSettings = connect(mapState, mapDispatch)(Settings);

export default ConnectedSettings;

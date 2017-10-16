/**
 * Connected Subscriptions component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { parseOPML } from '../stores/subscriptions';

import Subscriptions from '../components/Subscriptions';

const mapState = (state: IState) => ({
  ...state.subscriptions,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      parseOPML,
    },
    dispatch,
  );

const ConnectedSubscriptions = connect(mapState, mapDispatch)(Subscriptions);

export default ConnectedSubscriptions;

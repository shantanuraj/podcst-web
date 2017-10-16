/**
 * Connect Index Redirect component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { navigate } from '../stores/router';

import IndexRedirect from '../components/IndexRedirect';

const mapState = (_state: IState) => ({});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      navigate,
    },
    dispatch,
  );

const ConnectedIndexRedirect = connect(mapState, mapDispatch)(IndexRedirect);

export default ConnectedIndexRedirect;

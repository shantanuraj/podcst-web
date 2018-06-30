/**
 * Connect Index Redirect component
 */

import { connect } from 'preact-redux';

import { navigate } from '../stores/router';

import IndexRedirect from '../components/IndexRedirect';

const mapState = () => ({});

const mapDispatch = {
  navigate,
};

const ConnectedIndexRedirect = connect(mapState, mapDispatch)(IndexRedirect);

export default ConnectedIndexRedirect;

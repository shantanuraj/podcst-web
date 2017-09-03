/**
 * Connected Loader component
 */

import {
  connect,
} from 'preact-redux';

import {
  State,
} from '../stores/root';

import Loader from '../components/Loader';

const mapState = (state: State) => ({
  loading: state.feed.top.loading,
});

const ConnectedLoader = connect(
  mapState,
)(Loader);

export default ConnectedLoader;

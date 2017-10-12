/**
 * Connected Import Podcasts component
 */

import {
  connect,
} from 'preact-redux';

import {
  bindActionCreators,
  Dispatch,
} from 'redux';

import {
  IState,
} from '../stores/root';

import {
  parseOPML,
} from '../stores/subscriptions';

import ImportPodcasts from '../components/ImportPodcasts';

const mapState = () => ({});

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
  parseOPML,
}, dispatch);

const ConnectedImportPodcasts = connect(
  mapState,
  mapDispatch,
)(ImportPodcasts);

export default ConnectedImportPodcasts;

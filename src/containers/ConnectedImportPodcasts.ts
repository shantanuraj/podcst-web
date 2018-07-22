/**
 * Connected Import Podcasts component
 */

import { connect } from 'react-redux';

import { parseOPML } from '../stores/subscriptions';

import ImportPodcasts from '../components/ImportPodcasts';

const mapState = () => ({});

const mapDispatch = {
  parseOPML,
};

const ConnectedImportPodcasts = connect(mapState, mapDispatch)(ImportPodcasts);

export default ConnectedImportPodcasts;

/**
 * Connected Recents component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import { recents } from '../utils/recents';

import Recents from '../components/recents';

const mapState = (state: IState) => ({
  episodes: recents(state.subscriptions.subs),
});

const ConnectedRecents = connect(mapState)(Recents);

export default ConnectedRecents;

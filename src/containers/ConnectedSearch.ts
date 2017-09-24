/**
 * Connected Seach component
 */

import {
  connect,
} from 'preact-redux';

import {
  Dispatch,
  bindActionCreators,
} from 'redux';

import {
  State,
} from '../stores/root';

import {
  dismissSearch,
  searchPodcasts,
  navigateResult,
  focusResult,
} from '../stores/search';

import {
  navigate,
} from '../stores/router';

import Search from '../components/Search';

const mapState = (state: State) => state.search;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  dismissSearch,
  searchPodcasts,
  navigateResult,
  focusResult,
  onResultSelect: (feed: string) => navigate(`/episodes?feed=${feed}`),
}, dispatch);

const ConnectedSearch = connect(
  mapState,
  mapDispatch,
)(Search);

export default ConnectedSearch;

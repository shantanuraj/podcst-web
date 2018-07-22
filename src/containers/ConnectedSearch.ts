/**
 * Connected Seach component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { dismissSearch, focusResult, navigateResult, searchPodcasts } from '../stores/search';

import { navigate } from '../stores/router';

import Search from '../components/Search';

const mapState = ({ app: { mode, theme }, search }: IState) => ({
  ...search,
  mode,
  theme,
});

const mapDispatch = {
  dismissSearch,
  focusResult,
  navigateResult,
  searchPodcasts,
  onResultSelect: (feed: string) => navigate(`/episodes?feed=${feed}`),
};

const ConnectedSearch = connect(mapState, mapDispatch)(Search);

export default ConnectedSearch;

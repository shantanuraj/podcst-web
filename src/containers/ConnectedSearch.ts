/**
 * Connected Seach component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { dismissSearch, focusResult, navigateResult, searchPodcasts } from '../stores/search';

import { navigate } from '../stores/router';

import Search from '../components/Search';

const mapState = (state: IState) => ({
  ...state.search,
  mode: state.app.mode,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      dismissSearch,
      focusResult,
      navigateResult,
      searchPodcasts,
      onResultSelect: (feed: string) => navigate(`/episodes?feed=${feed}`),
    },
    dispatch,
  );

const ConnectedSearch = connect(mapState, mapDispatch)(Search);

export default ConnectedSearch;

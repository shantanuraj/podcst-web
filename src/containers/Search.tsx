/**
 * Search container component
 */

import {
  Dispatch,
  bindActionCreators,
} from 'redux';
import {
  connect,
} from 'preact-redux';

import {
  State,
} from '../stores/root';

import {
  searchTexts,
} from '../stores/texts';

import Search from '../components/Search';

const mapState = (state: State) => ({
  query: state.texts.query
});

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  search: searchTexts,
}, dispatch);

const Connected = connect(
  mapState,
  mapDispatch,
)(Search);

export default Connected;

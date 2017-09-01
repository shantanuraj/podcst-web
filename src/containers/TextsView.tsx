/**
 * TextsView container component
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
  navigate,
} from '../stores/router';

import TextsView from '../components/TextsView';

const mapState = (state: State) => state.texts;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  showThread: (thread: string) => navigate(`/texts/${thread}`),
}, dispatch);

const Connected = connect(
  mapState,
  mapDispatch,
)(TextsView);

export default Connected;

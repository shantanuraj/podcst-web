/**
 * Application store configuration
 */

import {
  applyMiddleware,
  compose,
  createStore,
} from 'redux';

import {
  createEpicMiddleware,
} from 'redux-observable';

import {
  rootEpic,
  rootReducer,
  State,
} from './root';

import {
  getDefaultState,
} from './utils';

const epicMiddleware = createEpicMiddleware(rootEpic);

const composeEnhancers =
  (window as ReduxDevToolsEnabledWindow).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ ||
  compose;

export default function configureStore() {
  const store = createStore<State>(
    rootReducer,
    getDefaultState(),
    composeEnhancers(
      applyMiddleware(epicMiddleware),
    ),
  );

  return store;
}

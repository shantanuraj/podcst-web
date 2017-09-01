/**
 * Application store configuration
 */

import {
  compose,
  createStore,
  applyMiddleware,
} from 'redux';

import {
  createEpicMiddleware,
} from 'redux-observable';

import {
  State,
  rootEpic,
  rootReducer,
  getDefaultState,
} from './root';

const epicMiddleware = createEpicMiddleware(rootEpic);

const composeEnhancers = window['__REDUX_DEVTOOLS_EXTENSION_COMPOSE__'] || compose;

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

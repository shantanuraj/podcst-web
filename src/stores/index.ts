/**
 * Application store configuration
 */

import { applyMiddleware, compose, createStore } from 'redux';

import { createEpicMiddleware } from 'redux-observable';

import { IState, rootEpic, rootReducer } from './root';

import { getDefaultState } from './utils';

const epicMiddleware = createEpicMiddleware(rootEpic);

const composeEnhancers = (window as ReduxDevToolsEnabledWindow).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

export default function configureStore() {
  const store = createStore<IState>(rootReducer, getDefaultState(), composeEnhancers(applyMiddleware(epicMiddleware)));

  return store;
}

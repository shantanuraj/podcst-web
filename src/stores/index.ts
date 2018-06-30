/**
 * Application store configuration
 */

import { applyMiddleware, compose, createStore } from 'redux';

import { createEpicMiddleware, Epic } from 'redux-observable';

import { Actions, getRootEpic, IState, rootReducer } from './root';

import { getDefaultState } from './utils';

const epicMiddleware = createEpicMiddleware();

const composeEnhancers = (window as IReduxDevToolsEnabledWindow).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

export default function configureStore() {
  const store = createStore<IState, Actions, {}, {}>(
    rootReducer,
    getDefaultState(),
    composeEnhancers(applyMiddleware(epicMiddleware)),
  );
  const rootEpic = getRootEpic(store.dispatch);
  epicMiddleware.run(rootEpic as Epic<Actions, Actions, any>);
  return store;
}

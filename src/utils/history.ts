/**
 * Custom history object
 */

import { createBrowserHistory } from 'history';
import { Store } from 'redux';

import { Actions, IState } from '../stores/root';
import { routerNavigate } from '../stores/router';

export const history = createBrowserHistory();

export const routeTo = (path: string) => history.push(path);

export const syncHistoryToStore = (store: Store<IState, Actions>) => {
  history.listen(({ pathname }) => {
    const { path } = store.getState().router;
    if (path !== pathname) {
      store.dispatch(routerNavigate(pathname));
    }
  });
};

export default history;

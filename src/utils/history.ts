/**
 * Custom history object
 */

import { createBrowserHistory } from 'history';

export const history = createBrowserHistory();

export const routeTo = (path: string) => history.push(path);

export default history;

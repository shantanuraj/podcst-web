/**
 * Custom history object
 */

import { createBrowserHistory } from 'history';

export const history = createBrowserHistory();

export const routeTo = history.push;

export default history;

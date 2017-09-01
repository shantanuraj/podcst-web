/**
 * Root app file
 */

import {
  h,
  render,
} from 'preact';

// Patch Rx operators
import './utils/patch_operators';

import App from './components/App';

render(<App />, document.body);

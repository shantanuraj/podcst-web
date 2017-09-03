import {
  normalize,
  setupPage,
} from 'csstips';

import {
  cssRule,
} from 'typestyle';

/**
 * Global styles
 */
export const fixGlobalStyles = () => {
  normalize();
  setupPage('body');
  cssRule('html, body', {
    fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
  });
  cssRule('p', {
    margin: 0,
  });
};

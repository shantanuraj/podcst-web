import {
  normalize,
  setupPage,
} from 'csstips';

import {
  cssRule,
  style,
} from 'typestyle';

const fontFamily = `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`;

/**
 * Global styles
 */
export const fixGlobalStyles = (theme: App.Theme) => {
  normalize();
  setupPage('body');
  cssRule('body', {
    fontFamily,
    backgroundColor: theme.background,
  });
  cssRule('p, pre', {
    margin: 0,
  });
  cssRule('a', {
    color: 'inherit',
    textDecoration: 'none',
  });
  cssRule('input, button', { fontFamily });
};

export const normalizeEl = style({
  height: '100%',
  width: '100%',
});

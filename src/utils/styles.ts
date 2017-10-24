import { normalize, setupPage } from 'csstips';

import { cssRule, media, style } from 'typestyle';

/**
 * Font family for application
 */
const fontFamily = [
  '-apple-system',
  `BlinkMacSystemFont`,
  `"Segoe UI"`,
  `Helvetica`,
  `Arial`,
  `sans-serif`,
  `"Apple Color Emoji"`,
  `"Segoe UI Emoji"`,
  `"Segoe UI Symbol"`,
].join(', ');

/**
 * Global styles
 */
export const fixGlobalStyles = (theme: App.ITheme) => {
  normalize();
  setupPage('#root');
  cssRule('body, #root', {
    backgroundColor: theme.background,
    fontFamily,
  });
  cssRule('p, pre', {
    margin: 0,
  });
  cssRule('a', {
    color: 'inherit',
    textDecoration: 'none',
  });
  cssRule('input, button', { fontFamily });
  cssRule(
    '[data-hide-on-mobile]',
    media(
      { maxWidth: 600 },
      {
        display: 'none',
      },
    ),
  );
  cssRule(
    '[data-hide-on-desktop]',
    media(
      { minWidth: 600 },
      {
        display: 'none',
      },
    ),
  );
};

/**
 * Normalize element to take entire viewport
 */
export const normalizeEl = style({
  height: '100%',
  width: '100%',
});

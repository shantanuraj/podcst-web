/**
 * Light theme constants
 */

import { keyframes } from 'typestyle';

import { App } from '../typings';

const background = '#ffffff';
const accent = '#8649b2';

const backgroundDark = '#131313';
const backgroundLight = '#e3e3e3';

// tslint:disable:object-literal-sort-keys
const loaderAnimation = keyframes({
  '0%': {
    backgroundColor: '#c069ff',
  },
  '50%': {
    backgroundColor: '#60347f',
  },
  '100%': {
    backgroundColor: '#8649b2',
  },
});

const text = '#000000';
const subTitle = '#555555';
const textLight = background;
const backgroundSearch = '#cccccc';

const theme: App.ITheme = {
  accent,
  background,
  backgroundDark,
  backgroundLight,
  backgroundSearch,
  loaderAnimation,
  subTitle,
  text,
  textLight,
};

export default theme;

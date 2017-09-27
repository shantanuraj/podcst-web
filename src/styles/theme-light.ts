/**
 * Light theme constants
 */

import {
  keyframes,
} from 'typestyle';

const background = '#ffffff';
const accent = '#8649b2';

const backgroundDark = '#131313';
const backgroundLight = '#e3e3e3';

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

const theme: App.Theme = {
  accent,
  background,
  backgroundDark,
  backgroundLight,
  loaderAnimation,
  subTitle,
  text,
  textLight,
  backgroundSearch,
};

export default theme;

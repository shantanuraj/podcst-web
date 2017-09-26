/**
 * Light theme constants
 */

import {
  keyframes,
} from 'typestyle';

const background = '#FFFFFF';
const accent = '#8649B2';

const backgroundDark = '#131313';
const backgroundLight = '#E3E3E3';

const loaderAnimation = keyframes({
  '0%': {
    backgroundColor: '#C069FF',
  },
  '50%': {
    backgroundColor: '#60347F',
  },
  '100%': {
    backgroundColor: '#8649B2',
  },
});

const text = '#000000';
const subTitle = '#555555';
const textLight = background;

const theme: App.Theme = {
  accent,
  background,
  backgroundDark,
  backgroundLight,
  loaderAnimation,
  subTitle,
  text,
  textLight,
};

export default theme;

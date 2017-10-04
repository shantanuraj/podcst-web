/**
 * Dark theme constants
 */

import {
  keyframes,
} from 'typestyle';

const background = '#292929';
const accent = '#82ffb5';

const backgroundDark = '#131313';
const backgroundLight = '#333333';

// tslint:disable:object-literal-sort-keys
const loaderAnimation = keyframes({
  '0%': {
    backgroundColor: '#5cffa0',
  },
  '50%': {
    backgroundColor: '#00B778',
  },
  '100%': {
    backgroundColor: '#82ffb5',
  },
});

const text = '#ffffff';
const textLight = text;
const subTitle = '#cccccc';
const backgroundSearch = backgroundDark;

const theme: App.Theme = {
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

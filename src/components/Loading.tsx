/**
 * Loading view
 */

import {
  h,
} from 'preact';

import {
  keyframes,
  style,
} from 'typestyle';

const pulseAnimation = keyframes({
  '0%': {
    backgroundPosition: '0% 50%',
  },
  '50%': {
    backgroundPosition: '100% 50%',
  },
  '100%': {
    backgroundPosition: '0% 50%',
  },
});

const loading = style({
  height: '100%',
  width: '100%',
  background: `linear-gradient(-45deg, #80CBC4, #A7FFEB, #F48FB1, #FFEE58)`,
  backgroundSize: '400% 400%',
  animation: `${pulseAnimation} 4s ease infinite`,
});

const Loading = () => (
  <div class={loading} />
);

export default Loading;

/**
 * Loader component
 */

import {
  h,
} from 'preact';

import {
  keyframes,
  style,
} from 'typestyle';

const loadingAnimation = keyframes({
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

const loadingStyle = style({
  position: 'fixed',
  top: 0,
  left: 0,
  height: '4px',
  width: '100%',
  zIndex: 501,
  animation: `${loadingAnimation} 2s infinite`,
});

interface LoaderProps {
  loading: boolean;
}

const Loader = ({
  loading,
}: LoaderProps) => (
  loading ?
    <div class={loadingStyle} /> :
    null
);

export default Loader;

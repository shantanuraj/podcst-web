/**
 * Loader component
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

const loadingStyle = (theme: App.Theme) => style({
  position: 'fixed',
  top: 0,
  left: 0,
  height: '4px',
  width: '100%',
  zIndex: 501,
  animation: `${theme.loaderAnimation} 2s infinite`,
});

interface LoaderProps {
  loading: boolean;
  theme: App.Theme;
}

const Loader = ({
  loading,
  theme,
}: LoaderProps) => (
  loading ?
    <div class={loadingStyle(theme)} /> :
    null
);

export default Loader;

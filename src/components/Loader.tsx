/**
 * Loader component
 */

import * as React from 'react';

import { style } from 'typestyle';

const loadingStyle = (theme: App.ITheme) =>
  style({
    position: 'fixed',
    top: 0,
    left: 0,
    height: '4px',
    width: '100%',
    zIndex: 1000,
    animation: `${theme.loaderAnimation} 2s infinite`,
  });

interface ILoaderProps {
  loading: boolean;
  theme: App.ITheme;
}

const Loader = ({ loading, theme }: ILoaderProps) => (loading ? <div className={loadingStyle(theme)} /> : null);

export default Loader;

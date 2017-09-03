/**
 * Loader component
 */

import {
  h,
} from 'preact';

interface LoaderProps {
  loading: boolean;
}

const styles = {
  loader: {
    postion: 'fixed',
    top: 0,
    left: 0,
    height: '2px',
    width: '100%',
    zIndex: 501,
    backgroundColor: 'red',
  },
};

const Loader = ({
  loading,
}: LoaderProps) => (
  loading ?
    <div style={styles.loader} /> :
    null
);

export default Loader;

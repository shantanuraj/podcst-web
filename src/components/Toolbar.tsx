/**
 * Toolbar component
 */

import {
  h,
} from 'preact';

const styles = {
  toolbar: {
    position: 'fixed',
    top: 0,
    left: 0,
    height: '64px',
    width: '100%',
    zIndex: 500,
    boxShadow: `0 2px 2px -2px rgba(0,0,0,.15)`,
  },
};

const Toolbar = () => (
  <div style={styles.toolbar}>
  </div>
);

export default Toolbar;

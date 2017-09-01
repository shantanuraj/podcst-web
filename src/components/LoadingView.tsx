/**
 * LoadingView while texts are fetched
 */

import {
  h,
} from 'preact';

import {
  Progress,
  WindowContent,
} from './ProtonUI';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: `100%`,
  },
  icon: {
    fontSize: 20,
  },
};

const LoadingView = () => (
  <WindowContent>
    <div style={styles.container}>
      <Progress />
      <p>Loading...</p>
    </div>
  </WindowContent>
);

export default LoadingView;

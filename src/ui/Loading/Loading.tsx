import * as React from 'react';
import { LoadBar } from '../LoadBar';
import styles from './Loading.module.css';

export const Loading = React.memo(function Loading() {
  return (
    <React.Fragment>
      <LoadBar />
      <div aria-label="Loading..." className={styles.loading} />
    </React.Fragment>
  );
});

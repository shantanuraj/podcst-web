/**
 * Loader component
 */

import {
  h,
} from 'preact';

interface LoaderProps {
  loading: boolean;
}

export default ({
  loading,
}: LoaderProps) => (
  loading ?
    <div /> :
    null
);

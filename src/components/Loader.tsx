/**
 * Loader component
 */

import {
  h,
} from 'preact';

interface LoaderProps {
  loading: boolean;
}

const Loader = ({
  loading,
}: LoaderProps) => (
  loading ?
    <div /> :
    null
);

export default Loader;

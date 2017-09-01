/**
 * Search component
 */

import {
  h,
} from 'preact';

import {
  onEvent,
} from '../utils';

interface SearchProps {
  query: string;
  search: (query: string) => void;
}

const Search = (props: SearchProps) => (
  <input
    class="form-control"
    type="search"
    placeholder="Search..."
    value={props.query}
    onInput={onEvent(props.search)}
  />
);

export default Search;

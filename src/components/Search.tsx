/**
 * Search component for toolbar
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

const search = style({
  padding: 16,
  height: 'inherit',
  boxShadow: 'inset 0 2px 5px rgba(0,0,0,.2)',
  backgroundColor: '#131313',
  border: '1px solid #131313',
  borderRadius: '4px',
  outline: 'none',
  color: 'white',
});

interface SearchProps {
  class?: string;
}

const Search = (props: SearchProps) => (
  <div class={props.class}>
    <input placeholder={'Search'} class={search} type="text" />
  </div>
);

export default Search;

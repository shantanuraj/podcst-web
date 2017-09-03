/**
 * Episode view
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

const episode = style({
  padding: 16,
});

const lineBreak = style({
  marginTop: 16,
  width: 'auto',
  height: '1px',
  borderBottom: '1px #eaeaea solid',
});

const Episode = ({
  title,
}: App.Episode) => (
  <div class={episode}>
    {title}
    <div class={lineBreak} />
  </div>
);

export default Episode;

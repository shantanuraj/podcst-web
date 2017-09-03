/**
 * Episode view
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  monthName,
} from '../utils';

const episode = style({
  padding: 16,
});

const lineBreak = style({
  marginTop: 16,
  width: 'auto',
  height: '1px',
  borderBottom: '1px #eaeaea solid',
});

const episodeRow = style({
  display: 'flex',
  justifyContent: 'space-between',
});

const infoContainer = style({
  display: 'flex',
});

const subContainer = style({
  marginRight: 16,
  color: '#ccc',
});

const playInfo = style({
  display: 'flex',
  alignItems: 'center',
});

const playButton = style({
  display: 'inline-block',
  borderRadius: '3px',
  padding: '8px',
  background: 'transparent',
  color: 'white',
  border: '2px solid #82ffb5',
  $nest: {
    '& :active, :focus': {
      outline: 0,
    },
  },
});

const Episode = ({
  title,
  published,
  duration,
}: App.Episode) => {

  const pub = new Date(published || Date.now());
  const day = pub.getDay();
  const month = monthName(pub.getMonth());
  const episodeLength = duration ? `${Math.floor(duration / 60)} mins` : '';

  return (
    <div class={episode}>
      <div class={episodeRow}>
        <div class={infoContainer}>
          <div class={subContainer}>
            {`${month} ${day}`}
          </div>
          <div>
            {title}
          </div>
        </div>
        <div class={playInfo}>
          <div class={subContainer}>
            {episodeLength}
          </div>
          <button class={playButton}>
            Play
          </button>
        </div>
      </div>
      <div class={lineBreak} />
    </div>
  );
};

export default Episode;

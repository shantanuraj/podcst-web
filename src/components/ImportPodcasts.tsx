/**
 * Import Podcasts component
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

const container = style({
  height: '100%',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const importButton = style({
  background: 'transparent',
  border: '2px solid #82ffb5',
  borderRadius: '3px',
  color: 'white',
  display: 'inline-block',
  minWidth: '200px',
  padding: '8px',
  $nest: {
    '& input': {
      display: 'none',
    },
  },
});

const ImportPodcasts = () => (
  <div class={container}>
    <button class={importButton}>
      <div>
        <input
          id="opml-import"
          accept=".xml, .opml"
          class="axis-import-input"
          name="file"
          type="file"
        />
        <label for="opml-import">
          Upload OPML File
        </label>
      </div>
    </button>
  </div>
);

export default ImportPodcasts;

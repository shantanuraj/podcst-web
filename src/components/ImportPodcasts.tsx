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

const onChange = (cb: (file: string) => void) => {
  return (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = (target.files as FileList)[0];
    const reader = new FileReader();
    reader.onload = () => {
      cb(reader.result);
      target.value = '';
    }
    reader.readAsText(file);
  };
}

interface ImportPodcastsProps {
  parseOPML: (contents: string) => void;
}

const ImportPodcasts = ({
  parseOPML,
}: ImportPodcastsProps) => (
  <div class={container}>
    <button class={importButton}>
      <div>
        <input
          id="opml-import"
          accept=".xml, .opml"
          class="axis-import-input"
          name="file"
          type="file"
          onChange={onChange(parseOPML)}
        />
        <label for="opml-import">
          Upload OPML File
        </label>
      </div>
    </button>
  </div>
);

export default ImportPodcasts;

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

const importButton = (theme: App.Theme) => style({
  background: 'transparent',
  border: `2px solid ${theme.accent}`,
  borderRadius: '3px',
  color: theme.text,
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
    };
    reader.readAsText(file);
  };
};

interface IImportPodcastsProps {
  parseOPML: (contents: string) => void;
  theme: App.Theme;
}

const ImportPodcasts = ({
  parseOPML,
  theme,
}: IImportPodcastsProps) => (
  <div class={container}>
    <button class={importButton(theme)}>
      <div>
        <input
          id="opml-import"
          accept=".xml, .opml"
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

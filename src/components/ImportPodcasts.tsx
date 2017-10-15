/**
 * Import Podcasts component
 */

import { h } from 'preact';

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
}

const ImportPodcasts = ({ parseOPML }: IImportPodcastsProps) => (
  <div>
    <input id="opml-import" accept=".xml, .opml" name="file" type="file" onChange={onChange(parseOPML)} />
    <label for="opml-import">Upload OPML File</label>
  </div>
);

export default ImportPodcasts;

/**
 * Show notes component for displaying episode notes
 */

import { h } from 'preact';

import { media, style } from 'typestyle';

const showNotesContainer = style(
  {
    padding: 32,
    paddingTop: 0,
    fontSize: 'large',
    $nest: {
      '&[data-is-player-visible]': {
        paddingBottom: 64,
      },
      '& *': {
        marginTop: 16,
        marginBottom: 16,
      },
    },
  },
  media(
    { maxWidth: 600 },
    {
      padding: 16,
      $nest: {
        '&[data-is-player-visible]': {
          paddingBottom: 128,
        },
      },
    },
  ),
);

interface IShowNotesProps {
  isPlayerVisible: boolean;
  showNotes: string;
}

const ShowNotes = ({ isPlayerVisible, showNotes }: IShowNotesProps) => (
  <div
    data-is-player-visible={isPlayerVisible}
    class={showNotesContainer}
    dangerouslySetInnerHTML={{ __html: showNotes }}
  />
);

export default ShowNotes;

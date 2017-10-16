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
      '& h2': {
        marginTop: 0,
        marginBottom: 16,
      },
      '& div *': {
        marginTop: 16,
        marginBottom: 16,
        textAlign: 'start',
        maxWidth: '100%',
      },
      '& div hr': {
        display: 'none',
      },
      '& div fieldset,legend': {
        border: 0,
        padding: 0,
      },
    },
  },
  media(
    { maxWidth: 600 },
    {
      padding: 16,
      paddingTop: 0,
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
  <div class={showNotesContainer}>
    <h2>Show Notes</h2>
    <div data-is-player-visible={isPlayerVisible} dangerouslySetInnerHTML={{ __html: showNotes }} />
  </div>
);

export default ShowNotes;

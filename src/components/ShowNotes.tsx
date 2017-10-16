/**
 * Show notes component for displaying episode notes
 */

import { h } from 'preact';

import { classes, media, style } from 'typestyle';

const showNotesContainer = style(
  {
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
      $nest: {
        '&[data-is-player-visible]': {
          paddingBottom: 128,
        },
      },
    },
  ),
);

interface IShowNotesProps {
  className?: string;
  isPlayerVisible: boolean;
  showNotes: string;
}

const ShowNotes = ({ className, isPlayerVisible, showNotes }: IShowNotesProps) => (
  <div class={classes(className, showNotesContainer)}>
    <h3>Show Notes</h3>
    <div data-is-player-visible={isPlayerVisible} dangerouslySetInnerHTML={{ __html: showNotes }} />
  </div>
);

export default ShowNotes;

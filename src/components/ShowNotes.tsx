/**
 * Show notes component for displaying episode notes
 */

import { h } from 'preact';

import { classes, media, style } from 'typestyle';

import { DESKTOP_PLAYER_HEIGHT } from '../utils/constants';

const showNotesContainer = style(
  {
    fontSize: 'large',
    $nest: {
      '&[data-is-player-visible]': {
        paddingBottom: DESKTOP_PLAYER_HEIGHT,
      },
      '& h3': {
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
          paddingBottom: DESKTOP_PLAYER_HEIGHT * 2,
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
  <div data-is-player-visible={isPlayerVisible} class={classes(className, showNotesContainer)}>
    <h3>Show Notes</h3>
    <div dangerouslySetInnerHTML={{ __html: showNotes }} />
  </div>
);

export default ShowNotes;

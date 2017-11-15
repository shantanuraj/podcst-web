/**
 * Show notes component for displaying episode notes
 */

import { h } from 'preact';

import { classes, style } from 'typestyle';

const showNotesContainer = style({
  fontSize: 'large',
  $nest: {
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
});

interface IShowNotesProps {
  className?: string;
  showNotes: string;
}

const ShowNotes = ({ className, showNotes }: IShowNotesProps) => (
  <div class={classes(className, showNotesContainer)}>
    <h3>Show Notes</h3>
    <div dangerouslySetInnerHTML={{ __html: showNotes }} />
  </div>
);

export default ShowNotes;

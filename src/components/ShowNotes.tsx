/**
 * Show notes component for displaying episode notes
 */

import * as React from 'react';

import { classes, style } from 'typestyle';
import { linkifyText } from '../utils';

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
  <div className={classes(className, showNotesContainer)}>
    <h3>Show Notes</h3>
    <div dangerouslySetInnerHTML={{ __html: linkifyText(showNotes) }} />
  </div>
);

export default ShowNotes;

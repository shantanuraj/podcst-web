/**
 * Connected QueueButton component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { addToQueue as add } from '../stores/player';

import QueueButton from '../components/QueueButton';

const mapState = ({ app: { theme } }: IState) => ({
  theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      add,
    },
    dispatch,
  );

const ConnectedQueueButton = connect(mapState, mapDispatch)(QueueButton);

export default ConnectedQueueButton;

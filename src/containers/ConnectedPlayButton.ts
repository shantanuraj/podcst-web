/**
 * Connected PlayButton component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { pauseEpisode, resumeEpisode } from '../stores/player';

import PlayButton, { IPlayButtonProps } from '../components/PlayButton';

const mapState = (
  { app: { theme }, player: { state } }: IState,
  ownProps: Partial<IPlayButtonProps>,
  ) => ({
  state,
  theme,
  ...ownProps
});

const mapDispatch = {
  pause: pauseEpisode,
  resume: resumeEpisode,
};

const ConnectedPlayButton = connect(mapState, mapDispatch)(PlayButton);

export default ConnectedPlayButton;

/**
 * Connected PlayButton component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { pauseEpisode, resumeEpisode } from '../stores/player';

import PlayButton from '../components/PlayButton';

const mapState = ({ app: { theme }, player: { state } }: IState) => ({
  state,
  theme,
});

const mapDispatch = {
  pause: pauseEpisode,
  resume: resumeEpisode,
};

const ConnectedPlayButton = connect(mapState, mapDispatch)(PlayButton);

export default ConnectedPlayButton;

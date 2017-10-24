/**
 * Connected PlayButton component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { pauseEpisode, resumeEpisode } from '../stores/player';

import PlayButton from '../components/PlayButton';

const mapState = (state: IState) => ({
  state: state.player.state,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      pause: pauseEpisode,
      resume: resumeEpisode,
    },
    dispatch,
  );

const ConnectedPlayButton = connect(mapState, mapDispatch)(PlayButton);

export default ConnectedPlayButton;

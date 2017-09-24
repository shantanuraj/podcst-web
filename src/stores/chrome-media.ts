/**
 * Manage Chrome for Android's media session state
 */


import {
  Epic,
} from 'redux-observable';

import {
  updateMetadata,
} from '../utils/chrome-media-utils';

import {
  Actions,
  State,
} from './root';

import {
  PLAY_EPISODE,
  PlayEpisodeAction,
} from './player';

interface UpdateChromeMetadataAction {
  type: 'UPDATE_CHROME_METADATA',
}
const UPDATE_CHROME_METADATA: UpdateChromeMetadataAction['type'] = 'UPDATE_CHROME_METADATA';
const updateChromeMetadatAction = (): UpdateChromeMetadataAction => ({
  type: UPDATE_CHROME_METADATA,
});

export type ChromeMediaActions = UpdateChromeMetadataAction;

/**
 * Chrome MediaSession Metadata epic
 */
export const chromeMediaMetadaUpdateEpic: Epic<Actions, State> = action$ =>
  action$.ofType(PLAY_EPISODE)
    .do((action: PlayEpisodeAction) => updateMetadata(action.episode))
    .map(updateChromeMetadatAction);

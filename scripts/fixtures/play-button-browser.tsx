import { QueryClient } from '@tanstack/react-query';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createRef, StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../../src/shared/auth/AccountBoundary';
import { AccountSession } from '../../src/shared/auth/account-session';
import { TranslationProvider } from '../../src/shared/i18n';
import AudioUtils from '../../src/shared/player/AudioUtils';
import { usePlayer } from '../../src/shared/player/usePlayer';
import type { IEpisodeInfo, PlayerState } from '../../src/types';
import {
  PlayButton,
  type PlayButtonProps,
} from '../../src/ui/Button/PlayButton';

const episode = (id: string): IEpisodeInfo => ({
  id,
  podcastId: id,
  guid: id,
  feed: `https://example.invalid/${id}.rss`,
  title: `Episode ${id}`,
  duration: 600,
  cover: '',
  summary: null,
  published: null,
  explicit: false,
  link: null,
  author: null,
  episodeArt: null,
  showNotes: '',
  file: {
    url: `https://example.invalid/${id}.mp3`,
    length: 0,
    type: 'audio/mpeg',
  },
});

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function run() {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  const host = document.getElementById('app');
  assert(host, 'Missing root');
  const root = createRoot(host);
  const client = new QueryClient();
  const session = new AccountSession(client, null, {
    resetPlayer: (scope, revision) =>
      usePlayer.getState().setAccount(scope, revision),
    reload() {},
    publish() {},
  });
  const actions: string[] = [];
  AudioUtils.play = () => {};
  session.synchronizePlayer();
  usePlayer.setState({
    playEpisode: (item) => actions.push(`play:${item.id}`),
    pause: () => actions.push('pause'),
    resumeEpisode: () => actions.push('resume'),
  });
  const ref = createRef<HTMLButtonElement>();
  const router = {
    bfcacheId: 'fixture',
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace() {},
    prefetch() {},
  };
  const render = (props: PlayButtonProps) => {
    flushSync(() => {
      root.render(
        <StrictMode>
          <AppRouterContext.Provider value={router}>
            <AccountContext.Provider value={session}>
              <TranslationProvider>
                <PlayButton {...props} ref={ref} />
              </TranslationProvider>
            </AccountContext.Provider>
          </AppRouterContext.Provider>
        </StrictMode>,
      );
    });
  };
  const playback = (item: IEpisodeInfo, state: PlayerState) => {
    flushSync(() => {
      usePlayer.setState({ queue: [item], currentTrackIndex: 0, state });
    });
  };
  const button = () => {
    const element = host.querySelector('button');
    assert(element, 'Missing play button');
    assert(ref.current === element, 'Button ref was not forwarded');
    return element;
  };
  const expectButton = (text: string, current: boolean, size = 16) => {
    assert(button().textContent === text, `Expected button text ${text}`);
    assert(
      button().dataset.isCurrent === String(current),
      `Expected current episode ${current}`,
    );
    assert(
      button().querySelector('svg')?.getAttribute('width') === `${size}px`,
      `Expected icon size ${size}`,
    );
    assert(errors.length === 0, errors.join('\n'));
  };
  const [first, second] = [episode('1'), episode('2')];
  try {
    render({ episode: first, label: 'Play latest' });
    expectButton('Play latest', false);
    const playIcon = button().querySelector('svg')?.innerHTML;

    playback(first, 'buffering');
    expectButton('Pause', true);
    const pauseIcon = button().querySelector('svg')?.innerHTML;
    assert(playIcon !== pauseIcon, 'Playing button retained the play icon');
    playback(first, 'playing');
    expectButton('Pause', true);
    playback(first, 'paused');
    expectButton('Resume', true);

    render({ episode: first, icon: true });
    expectButton('', true, 30);
    assert(
      button().querySelector('svg')?.innerHTML === playIcon,
      'Paused icon button did not show play',
    );
    playback(first, 'playing');
    expectButton('', true, 30);
    assert(
      button().querySelector('svg')?.innerHTML === pauseIcon,
      'Playing icon button did not show pause',
    );
    render({ episode: first, label: 'Play latest' });
    expectButton('Pause', true);

    playback(first, 'idle');
    expectButton('Play latest', false);
    render({ episode: first });
    expectButton('Play', false);
    render({ episode: first, label: 'Play latest' });
    expectButton('Play latest', false);

    playback(first, 'playing');
    expectButton('Pause', true);
    render({ episode: second, label: 'Play latest' });
    expectButton('Play latest', false);
    button().click();
    playback(second, 'playing');
    expectButton('Pause', true);
    button().click();
    playback(second, 'paused');
    expectButton('Resume', true);
    button().click();
    render({ episode: first });
    expectButton('Play', false);
    button().click();
    assert(
      actions.join(',') === 'play:2,pause,resume,play:1',
      `Wrong playback actions: ${actions.join(',')}`,
    );
    assert(errors.length === 0, errors.join('\n'));
    return {
      stableHooks: true,
      playbackLabels: true,
      iconVariants: true,
      episodeChanges: true,
      playbackActions: true,
      forwardedRef: true,
    };
  } finally {
    flushSync(() => root.unmount());
    client.clear();
    console.error = originalError;
  }
}

void Promise.resolve()
  .then(run)
  .then(
    (checks) =>
      fetch('/result', {
        method: 'POST',
        body: JSON.stringify({ passed: true, checks }),
      }),
    (error: Error) =>
      fetch('/result', {
        method: 'POST',
        body: JSON.stringify({ passed: false, error: error.stack }),
      }),
  );

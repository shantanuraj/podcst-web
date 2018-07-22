/**
 * Seekbar component
 */

import * as React from 'react';

import { media, style } from 'typestyle';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

import { App } from '../typings';

const seekbarContainer = (theme: App.ITheme, mode: 'inline' | 'absolute') =>
  style(
    {
      cursor: 'pointer',
      backgroundColor: theme.backgroundLight,
    },
    mode === 'absolute'
      ? {
          position: 'absolute',
          left: DESKTOP_PLAYER_HEIGHT,
          top: 0,
          right: 0,
          height: 4,
        }
      : {
          height: 8,
          width: '100%',
        },
    media(
      { maxWidth: 600 },
      mode === 'absolute'
        ? {
            left: MOBILE_PLAYER_HEIGHT,
          }
        : {},
    ),
  );

const seekbar = (theme: App.ITheme, mode: 'inline' | 'absolute') =>
  style(
    {
      backgroundColor: theme.accent,
      transition: 'width 1s',
      $nest: {
        '&[data-is-buffering]': {
          animation: `${theme.loaderAnimation} 2s infinite`,
          width: '100%',
        },
      },
    },
    mode === 'absolute'
      ? {
          height: 4,
          position: 'absolute',
          top: 0,
          left: 0,
        }
      : {
          height: 8,
          borderRadius: 8,
        },
  );

export interface ISeekbarProps {
  // Passed props
  mode: 'inline' | 'absolute';

  // Connected props
  duration: number;
  seekPosition: number;
  buffering: boolean;
  theme: App.ITheme;
  onSeek: (seekPosition: number, duration: number) => void;
}

class Seekbar extends React.PureComponent<ISeekbarProps, any> {
  private el: HTMLDivElement | null = null;

  private seekHandler = (e: MouseEvent) => {
    const { duration, onSeek } = this.props;

    if (this.el) {
      const seekFraction = e.offsetX / this.el.offsetWidth;
      const newSeekPosition = Math.floor(seekFraction * duration);
      onSeek(newSeekPosition, duration);
    }
  };

  private saveRef = (el: HTMLElement | undefined) => {
    if (el) {
      this.el = el as HTMLDivElement;
    }
  };

  private getSeekWidth(seekPosition: number, duration: number, buffering: boolean): string {
    return buffering ? '100%' : `${seekPosition / duration * 100}%`;
  }

  public render() {
    const { buffering, duration, mode, seekPosition, theme } = this.props;
    return (
      <div ref={this.saveRef} className={seekbarContainer(theme, mode)} onClick={this.seekHandler}>
        <div
          data-is-buffering={buffering}
          className={seekbar(theme, mode)}
          style={{ width: this.getSeekWidth(seekPosition, duration, buffering) }}
        />
      </div>
    );
  }
}

export default Seekbar;

/**
 * Seekbar component
 */

import { Component, h } from 'preact';

import { style } from 'typestyle';

// import { formatTime } from '../utils';

const seekbarContainer = (theme: App.ITheme) =>
  style({
    position: 'absolute',
    left: 96,
    top: 0,
    right: 0,
    height: 4,
    cursor: 'pointer',
    backgroundColor: theme.backgroundLight,
  });

const seekbar = (theme: App.ITheme) =>
  style({
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: theme.accent,
    transition: 'width 1s',
    $nest: {
      '&[data-is-buffering]': {
        animation: `${theme.loaderAnimation} 2s infinite`,
        width: '100%',
      },
    },
  });

interface ISeekbarProps {
  duration: number;
  seekPosition: number;
  buffering: boolean;
  theme: App.ITheme;
  onSeek: (seekPosition: number, duration: number) => void;
}

class Seekbar extends Component<ISeekbarProps, any> {
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

  public componentDidMount() {
    if (this.el) {
      this.el.addEventListener('click', this.seekHandler);
    }
  }

  public componentWillMount() {
    if (this.el) {
      this.el.removeEventListener('click', this.seekHandler);
    }
  }

  public render({ buffering, duration, seekPosition, theme }: ISeekbarProps) {
    return (
      <div ref={this.saveRef} class={seekbarContainer(theme)}>
        <div
          data-is-buffering={buffering}
          class={seekbar(theme)}
          style={{ width: this.getSeekWidth(seekPosition, duration, buffering) }}
        />
      </div>
    );
  }
}

export default Seekbar;

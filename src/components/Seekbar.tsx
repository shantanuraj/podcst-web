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

  public render({ duration, seekPosition, theme }: ISeekbarProps) {
    return (
      <div ref={this.saveRef} class={seekbarContainer(theme)}>
        <div class={seekbar(theme)} style={{ width: `${seekPosition / duration * 100}%` }} />
      </div>
    );
  }
}

export default Seekbar;

// {buffering ? 'Buffering...' : formatTime(duration, seekPosition)}

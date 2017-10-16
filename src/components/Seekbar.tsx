/**
 * Seekbar component
 */

import { Component, h } from 'preact';

import { media, style } from 'typestyle';

import { formatTime } from '../utils';

const seekbarContainer = (theme: App.ITheme) =>
  style(
    {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      flexGrow: 1,
      height: '100%',
      backgroundColor: theme.background,
    },
    media(
      { maxWidth: 600 },
      {
        opacity: 0.8,
        backgroundColor: theme.background + 'cc',
      },
    ),
  );

const seekbar = style({
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  backgroundColor: `rgba(0, 0, 0, 0.5)`,
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
        {buffering ? 'Buffering...' : formatTime(duration, seekPosition)}
        <div
          class={seekbar}
          style={{
            width: `${seekPosition / duration * 100}%`,
          }}
        />
      </div>
    );
  }

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
}

export default Seekbar;

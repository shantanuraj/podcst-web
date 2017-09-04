/**
 * Seekbar component
 */

import {
  h,
  Component,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  formatTime,
} from '../utils';

const seekbarContainer = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexGrow: 1,
  height: '100%',
});

const seekbar = style({
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  backgroundColor: `rgba(0, 0, 0, 0.5)`,
  transition: 'width 1s',
});

interface SeekbarProps {
  duration: number;
  seekPosition: number;
  onSeek: (seekPosition: number, duration: number) => void;
}

class Seekbar extends Component<SeekbarProps, any> {
  private el: HTMLDivElement | null = null;

  componentDidMount() {
    if (this.el) {
      this.el.addEventListener('click', this.seekHandler);
    }
  }

  componentWillMount() {
    if (this.el) {
      this.el.removeEventListener('click', this.seekHandler);
    }
  }

  private seekHandler = (e: MouseEvent) => {
    const {
      duration,
      onSeek,
    } = this.props;

    if (this.el) {
      const seekFraction = e.offsetX / this.el.offsetWidth;
      const newSeekPosition = Math.floor(seekFraction * duration);
      onSeek(newSeekPosition, duration);
    }
  }

  private saveRef = (el: HTMLElement | undefined) => {
    if (el) {
      this.el = el as HTMLDivElement;
    }
  }

  render({
    duration,
    seekPosition,
  }: SeekbarProps) {
    return (
      <div ref={this.saveRef} class={seekbarContainer}>
        {formatTime(duration, seekPosition)}
        <div
          style={{
            width: `${(seekPosition / duration * 100)}%`,
          }}
          class={seekbar}
        />
      </div>
    );
  }
}

export default Seekbar;

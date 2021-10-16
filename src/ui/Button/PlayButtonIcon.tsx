import { forwardRef, memo } from 'react';

import { Icon } from '../icons/svg/Icon';
import { PlayButton, PlayButtonProps } from './PlayButton';
import styles from './Button.module.css';

export const PlayButtonIcon = memo(
  forwardRef<HTMLButtonElement, PlayButtonProps>(function PlayButtonIcon({ episode }, ref) {
    return (
      <PlayButton className={styles.withIcon} episode={episode} ref={ref}>
        {PlayButtonContent}
      </PlayButton>
    );
  }),
);

const PlayButtonContent = ({
  isCurrentEpisode,
  isPlaying,
}: {
  isCurrentEpisode: boolean;
  isPlaying: boolean;
}) => {
  return <Icon icon={isCurrentEpisode && isPlaying ? 'pause' : 'play'} size={30} />;
};

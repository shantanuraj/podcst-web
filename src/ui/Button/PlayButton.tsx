import { forwardRef, memo } from 'react';
import { Button, ButtonProps } from './Button';

type PlayButton = ButtonProps & {
  episode?: never;
};

export const PlayButton = memo(
  forwardRef<HTMLButtonElement, PlayButton>(function PlayButton(_props, ref) {
    return (
      <Button ref={ref} onClick={() => alert('TBD')}>
        Play
      </Button>
    );
  }),
);

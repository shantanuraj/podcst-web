'use client';

import { forwardRef, memo } from 'react';
import { Button, ButtonProps } from './Button';

interface ShareButtonProps extends ButtonProps {
  text: string;
  title: string;
}

const share = ({ text, title }: ShareButtonProps, url: string) => {
  if (typeof window === 'undefined') return;
  if ('share' in navigator) {
    navigator.share({ text, title, url }).catch((err) => console.error('Error sharing', err));
  }
};

export const ShareButton = memo(
  forwardRef<HTMLButtonElement, ShareButtonProps>(function ShareButton(props, ref) {
    return (
      <Button {...(props as ButtonProps)} ref={ref} onClick={() => share(props, '')}>
        Share
      </Button>
    );
  }),
);

ShareButton.displayName = 'ShareButton';

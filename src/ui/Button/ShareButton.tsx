import { forwardRef, memo } from 'react';
import { IShareEnabledNavigator } from '../../types';
import { Button, ButtonProps } from './Button';

type ShareButtonProps = ButtonProps & {
  text: string;
  title: string;
  url: string;
};

const share = ({ text, title, url }: ShareButtonProps) => {
  if (typeof window === 'undefined') return;
  if ('share' in navigator) {
    (navigator as IShareEnabledNavigator)
      .share({ text, title, url })
      .catch((err) => console.error('Error sharing', err));
  }
};

export const ShareButton = memo(
  forwardRef<HTMLButtonElement, ShareButtonProps>(function ShareButton(props, ref) {
    if (typeof window === 'undefined' || !('share' in navigator)) return null;
    return <Button {...(props as ButtonProps)} ref={ref} onClick={() => share(props)} />;
  }),
);

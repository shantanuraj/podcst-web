/**
 * Toast component
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

import {
  IToastState,
} from '../stores/toast';

const toastContainer = (theme: App.Theme) => style({
  position: 'fixed',
  bottom: 0,
  left: 0,
  margin: 16,
  padding: 16,
  fontSize: 18,
  backgroundColor: theme.background,
  color: theme.text,
  boxShadow: `0px 1px 4px 1px rgba(0,0,0,0.75)`,
  zIndex: 501,
}, media({ maxWidth: 600 }, {
  margin: 0,
  width: '100%',
}));

interface IToastProps extends IToastState {
  theme: App.Theme;
}

const Toast = ({
  isVisible,
  message,
  theme,
}: IToastProps) => (
  isVisible ? (
    <div class={toastContainer(theme)}>
      {message}
    </div>
  ) : null
);

export default Toast;

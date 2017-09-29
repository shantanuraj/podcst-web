/**
 * Theme Picker settings component
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

import Icon from '../svg/Icon';

const container = (theme: App.Theme) => style({
  display: 'flex',
  flexDirection: 'column',
  padding: 32,
  color: theme.text,
  fontSize: 18,
  $nest: {
    '& > span': {
      marginBottom: 16,
    },
    '& > div': {
      display: 'flex',
      alignItems: 'center',
    },
    '& label': {
      display: 'flex',
      alignItems: 'center',
      padding: 16,
    },
  },
}, media({ maxWidth: 600 }, {
  padding: 16,
}));

interface ThemePickerProps {
  theme: App.Theme;
}

const ThemePicker = ({
  theme,
}: ThemePickerProps) => (
  <form class={container(theme)}>
    <span>Change theme</span>

    <div>
      <input type="radio" id="contactChoice1" name="contact" value="email" />
      <label for="contactChoice1">
        <Icon color={theme.text} icon="day" />
        Light
      </label>
    </div>

    <div>
      <input type="radio" id="contactChoice2" name="contact" value="phone" />
      <label for="contactChoice2">
        <Icon color={theme.text} icon="night" />
        Dark
      </label>
    </div>
  </form>
);

export default ThemePicker;

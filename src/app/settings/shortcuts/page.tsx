import { shortcuts } from '@/shared/keyboard/shortcuts';
import styles from '@/app/settings/Settings.module.css';

export const metadata = {
  title: 'Shortcuts',
};

export default function SettingsShortcutsPage() {
  return (
    <li className={styles.container}>
      {appShortcuts.map((shortcut) => (
        <ul key={shortcut.title} className={styles.shortcut}>
          <span>{shortcut.title}</span>
          <kbd data-surface={2}>{shortcut.displayKey}</kbd>
        </ul>
      ))}
    </li>
  );
}

const appShortcuts = Object.values(shortcuts);

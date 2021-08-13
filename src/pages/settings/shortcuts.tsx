import { shortcuts } from '../../shared/keyboard/shortcuts';
import styles from './Settings.module.css';

export default function SettingsShortcutsPage() {
  return (
    <div className={styles.container}>
      {appShortcuts.map((shortcut) => (
        <div key={shortcut.title} className={styles.shortcut}>
          <span>{shortcut.title}</span>
          <pre>
            {shortcut.displayKey}
          </pre>
        </div>
      ))}
    </div>
  );
}

const appShortcuts = Object.values(shortcuts);

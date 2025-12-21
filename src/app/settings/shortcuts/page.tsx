import { shortcuts } from '@/shared/keyboard/shortcuts';
import styles from '../Settings.module.css';

export const metadata = {
  title: 'Shortcuts',
};

export default function SettingsShortcutsPage() {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>Keyboard Shortcuts</h1>
        </header>
        <div>
          {appShortcuts.map((shortcut) => (
            <div key={shortcut.title} className={styles.shortcutRow}>
              <span className="text-base text-ink">{shortcut.title}</span>
              <kbd className="px-2 py-1 text-sm font-sans font-medium bg-surface border border-rule shadow-[0_2px_0_0_rgba(0,0,0,0.05)] min-w-[2.5rem] text-center">
                {shortcut.displayKey}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const appShortcuts = Object.values(shortcuts);

import styles from './Settings.module.css';

export default function SettingsShortcutsPage() {
  return (
    <div className={styles.container}>
      {shortcuts.map((shortcut) => (
        <div key={shortcut.title} className={styles.shortcut}>
          <span>{shortcut.title}</span>
          <pre>{shortcut.value}</pre>
        </div>
      ))}
    </div>
  );
}

interface IShortcutInfo {
  title: string;
  value: string;
}

const shortcuts: IShortcutInfo[] = [
  {
    title: 'Search',
    value: 's',
  },
  {
    title: 'Toggle drawer',
    value: 'd',
  },
  {
    title: 'Show episode info',
    value: 'e',
  },
  {
    title: 'Toggle theme',
    value: 't',
  },
  {
    title: 'Play / Pause',
    value: 'space',
  },
  {
    title: 'Seek back',
    value: 'left',
  },
  {
    title: 'Seek ahead',
    value: 'right',
  },
  {
    title: 'Seek to n %',
    value: '0-9',
  },
  {
    title: 'Open settings',
    value: ',',
  },
];

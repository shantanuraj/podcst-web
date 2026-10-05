import styles from './Equalizer.module.css';

export function Equalizer({ active }: { active: boolean }) {
  return (
    <span className={styles.equalizer} data-active={active} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import styles from './Menu.module.css';

export function Menu({
  label,
  trigger,
  triggerClassName,
  side = 'top',
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  side?: 'top' | 'bottom';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', dismiss, true);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.menu}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((open) => !open)}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} className={styles.panel} data-side={side}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

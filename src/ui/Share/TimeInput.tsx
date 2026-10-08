import { useState } from 'react';
import { timestampSeconds } from '@/shared/chapters';
import { formatSecondsToTimestamp } from '@/shared/player/formatTime';

export function TimeInput({
  value,
  max,
  onChange,
  className,
  id,
}: {
  value: number;
  max: number;
  onChange: (seconds: number) => void;
  className?: string;
  id: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const seconds = timestampSeconds(draft.trim());
    if (seconds !== null && seconds <= max) onChange(seconds);
    setDraft(null);
  };
  return (
    <input
      id={id}
      className={className}
      inputMode="numeric"
      value={draft ?? formatSecondsToTimestamp(value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

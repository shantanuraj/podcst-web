import type { AccountScope } from '@/shared/auth/account';
import type { IEpisodeInfo } from '@/types';

const KEY = 'player-session@1';

export interface PersistedSession {
  scope: AccountScope;
  queue: readonly IEpisodeInfo[];
  current: number;
  position: number;
}

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSession(scope: AccountScope): PersistedSession | null {
  try {
    const saved = JSON.parse(
      storage()?.getItem(KEY) ?? 'null',
    ) as PersistedSession | null;
    if (
      saved?.scope !== scope ||
      !Array.isArray(saved.queue) ||
      !saved.queue.length ||
      !Number.isInteger(saved.current) ||
      saved.current < 0 ||
      saved.current >= saved.queue.length
    )
      return null;
    return {
      ...saved,
      position: Number.isFinite(saved.position) ? saved.position : 0,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: PersistedSession) {
  try {
    storage()?.setItem(KEY, JSON.stringify(session));
  } catch {}
}

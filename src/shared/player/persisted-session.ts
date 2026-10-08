import type { AccountScope } from '@/shared/auth/account';
import { isCanonicalId, migrateStoredId } from '@/shared/canonical-id';
import type { IEpisodeInfo } from '@/types';

const LEGACY_KEY = 'player-session@1';
const KEY = 'player-session@2';
export interface PersistedSession {
  scope: AccountScope;
  queue: readonly IEpisodeInfo[];
  current: number;
  position: number;
  recoveryNotice?: string;
}
export function convertStoredEpisode(value: unknown): IEpisodeInfo {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid saved episode');
  const episode = value as IEpisodeInfo;
  if (
    typeof episode.feed !== 'string' ||
    typeof episode.guid !== 'string' ||
    !episode.file ||
    typeof episode.file.url !== 'string'
  )
    throw new Error('Invalid saved episode');
  const id = migrateStoredId(episode.id);
  const podcast = migrateStoredId(episode.podcastId);
  return {
    ...episode,
    id: 'canonicalId' in id ? id.canonicalId : undefined,
    podcastId: 'canonicalId' in podcast ? podcast.canonicalId : undefined,
  };
}
function storage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}
export function readSession(scope: AccountScope): PersistedSession | null {
  const local = storage();
  if (!local) return null;
  let raw = local.getItem(KEY);
  if (raw === null) {
    const source = local.getItem(LEGACY_KEY);
    if (source === null) return null;
    const old = JSON.parse(source) as PersistedSession;
    if (!Array.isArray(old.queue))
      throw new Error('Unreadable queue; source retained');
    if (
      (old.scope !== null && typeof old.scope !== 'string') ||
      !Number.isInteger(old.current) ||
      old.current < 0 ||
      (old.queue.length > 0 && old.current >= old.queue.length)
    )
      throw new Error('Unreadable queue; source retained');
    const unresolved = old.queue.filter(
      (episode) =>
        (episode.id !== undefined &&
          'unresolved' in migrateStoredId(episode.id)) ||
        (episode.podcastId !== undefined &&
          'unresolved' in migrateStoredId(episode.podcastId)),
    ).length;
    const session = { ...old, queue: old.queue.map(convertStoredEpisode) };
    raw = JSON.stringify({ version: 2, source, session, unresolved });
    local.setItem(KEY, raw);
  }
  const envelope = JSON.parse(raw);
  if (envelope.version !== 2)
    throw new Error('Unreadable queue; source retained');
  const saved = envelope.session as PersistedSession;
  if (saved?.scope !== scope) return null;
  if (
    !Array.isArray(saved.queue) ||
    !Number.isInteger(saved.current) ||
    saved.current < 0 ||
    (saved.queue.length > 0 && saved.current >= saved.queue.length) ||
    saved.queue.some(
      (episode) =>
        (episode.id !== undefined && !isCanonicalId(episode.id)) ||
        (episode.podcastId !== undefined && !isCanonicalId(episode.podcastId)),
    )
  )
    throw new Error('Unreadable queue; source retained');
  if (!saved.queue.length) return null;
  return {
    ...saved,
    position: Number.isFinite(saved.position) ? saved.position : 0,
    recoveryNotice: envelope.unresolved
      ? 'Older queue identities remain local and need resolution. Source retained.'
      : undefined,
  };
}
export function writeSession(session: PersistedSession) {
  const local = storage();
  if (!local) return;
  if (local.getItem(KEY) === null && local.getItem(LEGACY_KEY) !== null)
    readSession(session.scope);
  const previous = local.getItem(KEY);
  const envelope = previous
    ? JSON.parse(previous)
    : { version: 2, source: local.getItem(LEGACY_KEY) };
  if (envelope.version !== 2)
    throw new Error('Unreadable queue; source retained');
  local.setItem(KEY, JSON.stringify({ ...envelope, session }));
}

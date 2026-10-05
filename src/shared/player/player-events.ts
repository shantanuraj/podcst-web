import type { IEpisodeInfo } from '@/types';

export interface EpisodePosition {
  episode: IEpisodeInfo;
  position: number;
}

type Kind = 'complete' | 'leave';
type Listener = (value: EpisodePosition) => void;

const listeners: Record<Kind, Set<Listener>> = {
  complete: new Set(),
  leave: new Set(),
};

export function onPlayer(kind: Kind, listener: Listener) {
  listeners[kind].add(listener);
  return () => {
    listeners[kind].delete(listener);
  };
}

export function emitPlayer(kind: Kind, value: EpisodePosition) {
  for (const listener of listeners[kind]) listener(value);
}

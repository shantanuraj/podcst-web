import type { IEpisodeInfo } from '@/types';

export interface EpisodeList {
  id: string;
  kind: 'starred' | 'playlist';
  name: string | null;
  revision: string;
  itemCount: number;
}

export interface ListMembership {
  episodeId: number;
  addedAt: number;
  availability: 'available' | 'content_missing' | 'unavailable';
}

export interface ListSnapshot {
  listId: string;
  revision: string;
  items: ListMembership[];
}

export interface ListEpisodeItem extends ListMembership {
  episode: IEpisodeInfo | null;
}

export interface ListEpisodePage extends Omit<ListSnapshot, 'items'> {
  items: ListEpisodeItem[];
  nextCursor: string | null;
}

export interface ListChange {
  op: 'add' | 'remove';
  episodeId: number;
}

export interface ListBatch {
  clientId: string;
  sequence: string;
  changes: ListChange[];
}

export interface ListChangeResult {
  episodeId: number;
  status: 'applied' | 'unchanged' | 'not_found';
}

export interface ListAcknowledgement {
  clientId: string;
  sequence: string;
  listId: string;
  revision: string;
  results: ListChangeResult[];
}

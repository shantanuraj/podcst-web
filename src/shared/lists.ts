import type { StateScope, StateStream } from '@/shared/state-contract';
import type { IEpisodeInfo } from '@/types';

export interface EpisodeList {
  id: string;
  kind: 'starred' | 'playlist';
  name: string | null;
  revision: string;
  itemCount: number;
}
export interface ListsSnapshot extends StateScope {
  lists: EpisodeList[];
}
export interface ListMembership {
  episodeId: string;
  addedAt: number;
  availability: 'available' | 'content_missing' | 'unavailable';
}
export interface ListSnapshot extends StateScope {
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
  episodeId: string;
}
export interface ListBatch extends StateStream {
  changes: ListChange[];
}
export interface LegacyListBatch {
  clientId: string;
  sequence: string;
  changes: { op: 'add' | 'remove'; episodeId: number }[];
}
export interface ListChangeResult {
  episodeId: string;
  status: 'applied' | 'unchanged' | 'not_found';
}
export interface ListAcknowledgement extends StateStream {
  listId: string;
  revision: string;
  results: ListChangeResult[];
}

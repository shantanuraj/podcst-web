import { expect, test } from 'bun:test';
import { cases } from '../../../contracts/playback/queue.json';
import {
  emptySession,
  enqueue,
  finish,
  move,
  moveUpNext,
  play,
  type QueueSession,
  remove,
  removeUpNext,
  reopen,
  step,
  stop,
} from './queue';

type Step = { op: string } & Record<string, unknown>;

const same = (first: string, second: string) => first === second;

function apply(session: QueueSession<string>, { op, ...args }: Step) {
  switch (op) {
    case 'play':
      return play(session, args.episode as string, same);
    case 'enqueue':
      return enqueue(
        session,
        args.episode as string,
        args.next as boolean,
        same,
      );
    case 'finish':
    case 'markPlayed':
      return finish(session);
    case 'next':
      return step(session, 1);
    case 'previous':
      return step(session, -1);
    case 'remove':
      return remove(session, args.indices as number[]);
    case 'removeUpNext':
      return removeUpNext(session, args.offsets as number[]);
    case 'moveUpNext':
      return moveUpNext(session, args.from as number, args.to as number);
    case 'move':
      return move(session, args.from as number, args.to as number);
    case 'clear':
      return emptySession;
    case 'stop':
      return stop(session);
    case 'reopen':
      return reopen(session);
    case 'pause':
      return session;
  }
  throw new Error(`Unknown queue operation ${op}`);
}

function initial({ queue, current, active }: QueueSession<string>) {
  const session = queue.reduce<QueueSession<string>>(
    (session, episode) => enqueue(session, episode, false, same),
    emptySession,
  );
  if (active) return play(session, queue[current], same);
  return current > 0 ? stop(play(session, queue[current], same)) : session;
}

test.each(cases)('$name', (vector) => {
  const session = (vector.steps as Step[]).reduce(
    apply,
    initial(vector.initial),
  );
  expect(session).toEqual(vector.expected);
});

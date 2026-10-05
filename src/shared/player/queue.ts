export interface QueueSession<T> {
  readonly queue: readonly T[];
  readonly current: number;
  readonly active: boolean;
}

export type Same<T> = (first: T, second: T) => boolean;

export const emptySession: QueueSession<never> = {
  queue: [],
  current: 0,
  active: false,
};

export function play<T>(
  session: QueueSession<T>,
  episode: T,
  same: Same<T>,
): QueueSession<T> {
  const index = session.queue.findIndex((queued) => same(queued, episode));
  return index === -1
    ? {
        queue: [...session.queue, episode],
        current: session.queue.length,
        active: true,
      }
    : { ...session, current: index, active: true };
}

export function enqueue<T>(
  session: QueueSession<T>,
  episode: T,
  next: boolean,
  same: Same<T>,
): QueueSession<T> {
  if (session.queue.some((queued) => same(queued, episode))) return session;
  if (!session.queue.length) return { ...emptySession, queue: [episode] };
  return {
    ...session,
    queue: session.queue.toSpliced(
      next ? session.current + 1 : session.queue.length,
      0,
      episode,
    ),
  };
}

export function remove<T>(
  session: QueueSession<T>,
  indices: readonly number[],
): QueueSession<T> {
  const doomed = new Set(
    indices.filter((index) => index >= 0 && index < session.queue.length),
  );
  if (!doomed.size) return session;
  const queue = session.queue.filter((_, index) => !doomed.has(index));
  if (!queue.length) return emptySession;
  const following = doomed.has(session.current)
    ? session.queue.findIndex(
        (_, index) => index > session.current && !doomed.has(index),
      )
    : session.current;
  const target =
    following === -1
      ? session.queue.findIndex((_, index) => !doomed.has(index))
      : following;
  return {
    ...session,
    queue,
    current: target - [...doomed].filter((index) => index < target).length,
  };
}

export function finish<T>(session: QueueSession<T>): QueueSession<T> {
  return session.active ? remove(session, [session.current]) : session;
}

export function step<T>(
  session: QueueSession<T>,
  direction: 1 | -1,
): QueueSession<T> {
  const length = session.queue.length;
  if (!length) return session;
  return {
    ...session,
    current: (session.current + direction + length) % length,
    active: true,
  };
}

export function move<T>(
  session: QueueSession<T>,
  from: number,
  to: number,
): QueueSession<T> {
  const length = session.queue.length;
  if (from < 0 || from >= length) return session;
  const destination = Math.min(Math.max(to, 0), length);
  const order = session.queue.map((_, index) => index);
  order.splice(from, 1);
  order.splice(destination > from ? destination - 1 : destination, 0, from);
  return {
    ...session,
    queue: order.map((index) => session.queue[index]),
    current: order.indexOf(session.current),
  };
}

export function upNext<T>(session: QueueSession<T>): readonly T[] {
  return [
    ...session.queue.slice(session.current + 1),
    ...session.queue.slice(0, session.current),
  ];
}

function rotate<T>(session: QueueSession<T>): QueueSession<T> {
  return {
    ...session,
    queue: [
      ...session.queue.slice(session.current),
      ...session.queue.slice(0, session.current),
    ],
    current: 0,
  };
}

export function removeUpNext<T>(
  session: QueueSession<T>,
  offsets: readonly number[],
): QueueSession<T> {
  return remove(
    rotate(session),
    offsets.map((offset) => offset + 1),
  );
}

export function moveUpNext<T>(
  session: QueueSession<T>,
  from: number,
  to: number,
): QueueSession<T> {
  return move(rotate(session), from + 1, to + 1);
}

export function stop<T>(session: QueueSession<T>): QueueSession<T> {
  return { ...session, active: false };
}

export function reopen<T>(session: QueueSession<T>): QueueSession<T> {
  return { ...session, active: session.queue.length > 0 };
}

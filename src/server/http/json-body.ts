export class BodyError extends Error {
  constructor(readonly status: 400 | 408 | 413) {
    super('Invalid request body');
  }
}

export async function readJsonBody(
  request: Pick<Request, 'body' | 'headers' | 'signal'>,
  limit: number,
  timeoutMs: number,
  emptyBody?: unknown,
): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > limit)
    throw new BodyError(413);
  const reader = request.body?.getReader();
  if (!reader) {
    if (emptyBody !== undefined) return emptyBody;
    throw new BodyError(400);
  }
  const cleanup = new AbortController();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new BodyError(408));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    const cancel = () => {
      reject(new BodyError(408));
      void reader.cancel().catch(() => {});
    };
    if (request.signal.aborted) cancel();
    else
      request.signal.addEventListener('abort', cancel, {
        once: true,
        signal: cleanup.signal,
      });
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([
        reader.read(),
        deadline,
        aborted,
      ]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => {});
        throw new BodyError(413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400);
  } finally {
    clearTimeout(timer);
    cleanup.abort();
    reader.releaseLock();
  }
}

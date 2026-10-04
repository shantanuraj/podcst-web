export interface ArtworkTint {
  readonly light: string;
  readonly dark: string;
}

type Loader = (source: string) => Promise<ArtworkTint | null>;
type Entry = {
  promise: Promise<ArtworkTint | null>;
  expiresAt: number;
};

async function fetchTint(source: string): Promise<ArtworkTint | null> {
  const response = await fetch(source, {
    method: 'HEAD',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const light = response.headers.get('X-Artwork-Tint-Light');
  const dark = response.headers.get('X-Artwork-Tint-Dark');
  if (
    !light ||
    !dark ||
    !/^#[a-f0-9]{6}$/i.test(light) ||
    !/^#[a-f0-9]{6}$/i.test(dark)
  )
    return null;
  return { light: light.toLowerCase(), dark: dark.toLowerCase() };
}

export class ArtworkTintCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly load: Loader = fetchTint,
    private readonly now: () => number = Date.now,
  ) {}

  get(source: string): Promise<ArtworkTint | null> {
    const cached = this.entries.get(source);
    if (cached) {
      this.entries.delete(source);
      if (cached.expiresAt > this.now()) {
        this.entries.set(source, cached);
        return cached.promise;
      }
    }
    if (this.entries.size >= 64) {
      const oldest = [...this.entries].find(
        ([, entry]) => entry.expiresAt !== Infinity,
      );
      if (!oldest) return Promise.resolve(null);
      this.entries.delete(oldest[0]);
    }
    const entry: Entry = {
      expiresAt: Infinity,
      promise: Promise.resolve()
        .then(() => this.load(source))
        .catch(() => null)
        .then((tint) => {
          entry.expiresAt = this.now() + (tint ? 60 * 60_000 : 60_000);
          return tint;
        }),
    };
    this.entries.set(source, entry);
    return entry.promise;
  }
}

import { IMAGE_PROXY_URL } from '@/data/constants';

const proxyOrigin = new URL(IMAGE_PROXY_URL).origin;
const proxyHostname = new URL(IMAGE_PROXY_URL).hostname;
const widths = [160, 384, 1024];

function remoteURL(src: string) {
  try {
    const url = new URL(src);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function directArtwork(src?: string): string | undefined {
  let value = src;
  for (let depth = 0; value && depth < 4; depth++) {
    const url = remoteURL(value);
    if (!url) return undefined;
    if (url.hostname !== proxyHostname) return value;
    if (url.searchParams.getAll('p').length !== 1) return undefined;
    value = url.searchParams.get('p') ?? undefined;
  }
  return undefined;
}

export function artworkFallback(src?: string) {
  if (!src) return undefined;
  const source = remoteURL(src);
  if (!source || source.hostname === proxyHostname) return undefined;
  const proxy = new URL(IMAGE_PROXY_URL);
  proxy.searchParams.set('p', src);
  return proxy.toString();
}

function sizedArtworkURL(src?: string) {
  const proxy = src ? remoteURL(src) : undefined;
  if (!proxy || proxy.origin !== proxyOrigin) return undefined;
  const source = proxy.searchParams.get('p');
  const original = source ? remoteURL(source) : undefined;
  if (
    proxy.pathname !== '/' ||
    proxy.searchParams.getAll('p').length !== 1 ||
    !original ||
    original.hostname === proxyHostname
  ) {
    return undefined;
  }
  return proxy;
}

export function artworkTintSource(src?: string, privateSource = false) {
  if (privateSource) return undefined;
  const proxy = sizedArtworkURL(src);
  if (!proxy) return undefined;
  proxy.searchParams.set('w', String(widths[0]));
  proxy.hash = '';
  return proxy.toString();
}

export function artworkSources(src?: string, sizes?: string) {
  const proxy = sizes ? sizedArtworkURL(src) : undefined;
  if (!proxy) return { src };
  const variants = widths.map((width) => {
    const url = new URL(proxy);
    url.searchParams.set('w', String(width));
    return { url: url.toString(), width };
  });
  return {
    src: variants[1].url,
    srcSet: variants.map(({ url, width }) => `${url} ${width}w`).join(', '),
  };
}

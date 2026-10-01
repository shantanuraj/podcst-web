'use client';

import { type ImgHTMLAttributes, useEffect, useRef, useState } from 'react';
import {
  artworkFallback,
  artworkSources,
  directArtwork,
} from '@/shared/artwork';

interface ProxiedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  privateSource?: boolean;
}

export function ProxiedImage(props: ProxiedImageProps) {
  return <ArtworkImage key={props.src} {...props} />;
}

function ArtworkImage({
  src,
  srcSet,
  sizes,
  onError,
  privateSource = false,
  decoding = 'async',
  ...props
}: ProxiedImageProps) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const fallback = privateSource ? undefined : artworkFallback(src);
  const sources = privateSource
    ? { src: directArtwork(src), srcSet: undefined }
    : artworkSources(failed ? fallback : src, sizes);

  useEffect(() => {
    const element = image.current;
    if (
      fallback &&
      element?.complete &&
      element.currentSrc &&
      element.naturalWidth === 0
    ) {
      setFailed(true);
    }
  }, [fallback]);

  return (
    <img
      {...props}
      ref={image}
      decoding={decoding}
      sizes={sizes}
      srcSet={
        privateSource
          ? undefined
          : (sources.srcSet ?? (failed ? undefined : srcSet))
      }
      src={sources.src}
      onError={(event) => {
        onError?.(event);
        if (!event.defaultPrevented && !failed && fallback) setFailed(true);
      }}
    />
  );
}

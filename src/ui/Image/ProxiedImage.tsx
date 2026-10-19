'use client';

import { type ImgHTMLAttributes, useEffect, useRef, useState } from 'react';
import { artworkFallback, artworkSources } from '@/shared/artwork';

interface ProxiedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
}

export function ProxiedImage(props: ProxiedImageProps) {
  return <ArtworkImage key={props.src} {...props} />;
}

function ArtworkImage({
  src,
  srcSet,
  sizes,
  onError,
  decoding = 'async',
  ...props
}: ProxiedImageProps) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const fallback = artworkFallback(src);
  const sources = artworkSources(failed ? fallback : src, sizes);

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
      srcSet={sources.srcSet ?? (failed ? undefined : srcSet)}
      src={sources.src}
      onError={(event) => {
        onError?.(event);
        if (!event.defaultPrevented && !failed && fallback) setFailed(true);
      }}
    />
  );
}

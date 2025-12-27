'use client';

import { type ImgHTMLAttributes, useCallback, useRef } from 'react';
import { IMAGE_PROXY_URL } from '@/data/constants';

interface ProxiedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
}

export function ProxiedImage(props: ProxiedImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  const handleError = useCallback(() => {
    if (!imgRef.current || !props.src) return;
    imgRef.current.src = getProxySrc(props.src);
  }, [props.src, imgRef]);

  return <img {...props} ref={imgRef} onError={handleError} />;
}

const getProxySrc = (src: string) => {
  let finalSrc = src;
  try {
    const imgProxy = new URL(IMAGE_PROXY_URL);
    imgProxy.searchParams.set('p', src);
    finalSrc = imgProxy.toString();
  } catch (e) {
    console.error('Error parsing URL', e, src);
  }
  return finalSrc;
};

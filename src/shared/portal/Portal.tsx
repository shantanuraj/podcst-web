'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  id: string;
  children: Parameters<typeof createPortal>[0];
};

export const Portal = ({ id, children }: Props) => {
  const [mounted, setMounted] = useState(false);
  const rootElemRef = useRef<Element | null>(null);

  useEffect(() => {
    setMounted(true);
    rootElemRef.current = document.getElementById(id);
  }, []);

  return mounted && rootElemRef.current ? createPortal(children, rootElemRef.current) : null;
};

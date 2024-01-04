'use client';

import { createPortal } from 'react-dom';
import { usePortal } from './usePortal';

type Props = {
  id: string;
  children: Parameters<typeof createPortal>[0];
};

export const Portal = ({ id, children }: Props) => createPortal(children, usePortal(id));

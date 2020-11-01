import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePortal } from './usePortal';

type Props = {
  id: string;
  children: React.ReactNode;
};

export const Portal = ({ id, children }: Props) => createPortal(children, usePortal(id));

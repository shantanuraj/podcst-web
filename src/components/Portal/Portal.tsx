import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePortal } from '../../hooks/usePortal';

type Props = {
  id: string;
  children: React.ReactNode;
};

const Portal = ({ id, children }: Props) => createPortal(children, usePortal(id));

export default Portal;

'use client';

import { type MouseEvent, type ReactNode, useCallback } from 'react';

interface SpaLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
}

/**
 * SpaLink - A link component that uses window.history.pushState for navigation
 * instead of Next.js router to avoid RSC server requests.
 *
 * This enables instant client-side navigation within the SPA zone.
 */
export function SpaLink({ href, className, children }: SpaLinkProps) {
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Allow default behavior for modified clicks (new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      e.preventDefault();
      window.history.pushState(null, '', href);

      // Dispatch a popstate event to trigger usePathname update
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [href],
  );

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}

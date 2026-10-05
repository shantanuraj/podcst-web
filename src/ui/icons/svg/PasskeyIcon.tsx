import type { SVGProps } from 'react';

const PasskeyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="8" cy="8" r="4" />
    <path d="M2 20a6 6 0 0 1 10-4.5M15 13a3 3 0 1 1 3 3v5l-1.5-1.5L18 18" />
  </svg>
);

export default PasskeyIcon;

import type * as React from 'react';

function QueueList(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <line x1={4} y1={6} x2={14} y2={6} />
      <line x1={4} y1={10} x2={14} y2={10} />
      <line x1={4} y1={14} x2={10} y2={14} />
      <circle cx={17} cy={17} r={3} fill="currentColor" stroke="none" />
    </svg>
  );
}

export default QueueList;

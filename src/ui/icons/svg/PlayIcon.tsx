import * as React from 'react';

function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height={24} viewBox="0 0 24 24" width={24} {...props}>
      {props.children}
      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 000-1.69L9.54 5.98A.998.998 0 008 6.82z" />
    </svg>
  );
}

export default PlayIcon;

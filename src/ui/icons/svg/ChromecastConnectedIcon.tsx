import * as React from 'react';

function ChromecastConnectedIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height={24} viewBox="0 0 24 24" width={24} {...props}>
      <path d="M19 16V8c0-.55-.45-1-1-1H6c-.55 0-1 .45-1 1v.63c3.96 1.28 7.09 4.41 8.37 8.37H18c.55 0 1-.45 1-1zm2-13H3c-1.1 0-2 .9-2 2v2c0 .55.45 1 1 1s1-.45 1-1V6c0-.55.45-1 1-1h16c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1h-5c-.55 0-1 .45-1 1s.45 1 1 1h6c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3a2.99 2.99 0 00-3-3zm1.14-3.91c-.6-.1-1.14.39-1.14 1 0 .49.36.9.85.98 2.08.36 3.72 2 4.08 4.08.08.49.49.85.98.85.61 0 1.09-.54 1-1.14a6.997 6.997 0 00-5.77-5.77zm-.04-4.04c-.59-.05-1.1.41-1.1 1 0 .51.38.94.88.99 4.27.41 7.67 3.81 8.08 8.08.05.5.48.87.99.87.6 0 1.06-.52 1-1.11-.53-5.19-4.66-9.31-9.85-9.83z" />
    </svg>
  );
}

export default ChromecastConnectedIcon;

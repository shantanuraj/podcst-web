import Script from 'next/script';

import { CastManager } from '../components/CastManager/CastManager';
import { Player } from '../shared/player/Player';
import { ThemeListener } from '../shared/theme/ThemeListener';
import { Toast } from '../shared/toast/Toast';
import { Header } from '../ui/Header';
import { Init } from './Init';

import '../styles/global.css';
import styles from './PodcstApp.module.css';
import { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.podcst.app'),
  title: {
    default: 'Plays your favourite podcasts on all devices',
    template: '%s | Podcst',
  },
  description: 'Plays your favourite podcasts on all devices',
  authors: {
    name: 'Shantanu Raj',
    url: 'https://sraj.me',
  },
  viewport: 'initial-scale=1.0, width=device-width',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#60347f' },
    { media: '(prefers-color-scheme: dark)', color: '#00b778' },
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Podcst',
  },
  openGraph: {
    url: 'https://www.podcst.app',
    locale: 'en_US',
    siteName: 'Podcst',
    type: 'website',
    title: 'Podcst | Plays your favourite podcasts on all devices',
    description: 'Plays your favourite podcasts on all devices',
    images: 'https://www.podcst.app/receiver/cast-background.jpg',
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@shantanuraj',
    images: [
      'https://www.podcst.app/receiver/cast-background.jpg',
      'https://www.podcst.app/icons/launcher-512.png',
    ],
  },
  icons: {
    apple: [
      'https://www.podcst.app/icons/launcher-96.png',
      'https://www.podcst.app/icons/launcher-144.png',
      'https://www.podcst.app/icons/launcher-192.png',
      'https://www.podcst.app/icons/launcher-512.png',
    ],
    icon: '/icons/launcher-192.png',
  },
};

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <Init />
        <Header />

        <main className={styles.mainContainer}>{children}</main>
        <Toast />
        <Player />
        <ThemeListener />
        <CastManager />
        <Script id="castsetup">
          {`
window['__onGCastApiAvailable'] = function(isAvailable) {
if (
isAvailable &&
window.chrome &&
window.cast &&
window.chrome.cast &&
window.chrome.cast.media &&
window.cast.framework
) {
// Custom receiver
window.cast.framework.CastContext.getInstance().setOptions({
receiverApplicationId: '5152FC99',
autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
});
const event = new CustomEvent('cast-available', {});
document.dispatchEvent(event);
}
};`}
        </Script>
        <Script src="//www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1" />
      </body>
    </html>
  );
}

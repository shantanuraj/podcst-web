import Head from 'next/head';
import Script from 'next/script';

import { CastManager } from '../components/CastManager/CastManager';
import { Player } from '../shared/player/Player';
import { ThemeListener } from '../shared/theme/ThemeListener';
import { Toast } from '../shared/toast/Toast';
import { Header } from '../ui/Header';
import { Init } from './Init';

import '../styles/global.css';
import styles from './PodcstApp.module.css';

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <Head>
        <title>Podcst</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#60347f" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#00b778" />

        <meta property="og:title" content="Podcst | Plays your favourite podcasts on all devices" />
        <meta property="og:site_name" content="Podcst" />
        <meta property="og:type" content="website" />
        <meta property="og:description" content="Plays your favourite podcasts on all devices" />
        <meta property="og:url" content="https://www.podcst.app" />
        <meta property="og:locale" content="en_US" />
        <meta property="og:image" content="/icons/launcher-512.png" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:description" content="Plays your favourite podcasts on all devices" />
        <meta
          name="twitter:title"
          content="Podcst | Plays your favourite podcasts on all devices"
        />
        <meta name="twitter:site" content="@shantanuraj" />
        <meta name="twitter:image" content="/icons/launcher-512.png" />
        <meta name="twitter:creator" content="@shantanuraj" />

        <link rel="shortcut icon" href="/icons/launcher-192.png" />
        <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/ico" href="/icons/launcher-48.png" />

        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Podcst" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        <link rel="apple-touch-icon" href="/icons/launcher-96.png" />
        <link rel="apple-touch-icon" sizes="144x144" href="/icons/launcher-144.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/launcher-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/launcher-512.png" />
      </Head>
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

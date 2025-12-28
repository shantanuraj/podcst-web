import Script from 'next/script';

import { CastManager } from '@/components/CastManager/CastManager';
import { TranslationProvider } from '@/shared/i18n';
import { Player } from '@/shared/player/Player';
import { QueryProvider } from '@/shared/query/QueryProvider';
import { ThemeListener } from '@/shared/theme/ThemeListener';
import { Toast } from '@/shared/toast/Toast';
import { Init } from './Init';

import '@/styles/global.css';
import type { Metadata, Viewport } from 'next';
import { WebSiteSchema } from '@/components/Schema';
import { SiteHeader } from '@/ui/SiteHeader';
import styles from './PodcstApp.module.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.podcst.app'),
  title: {
    default: 'Podcst',
    template: '%s — Podcst',
  },
  description: 'A beautiful way to discover and listen to podcasts',
  authors: {
    name: 'Shantanu Raj',
    url: 'https://sraj.me/',
  },
  alternates: {
    canonical: '/',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Podcst',
  },
  openGraph: {
    url: 'https://www.podcst.app',
    locale: 'en_US',
    siteName: 'Podcst',
    type: 'website',
    title: 'Podcst',
    description: 'A beautiful way to discover and listen to podcasts',
  },
  twitter: {
    card: 'summary',
    creator: '@shantanuraj',
  },
};

export const viewport: Viewport = {
  initialScale: 1.0,
  width: 'device-width',
  themeColor: '#FAF9F7',
};

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WebSiteSchema />
        <QueryProvider>
          <TranslationProvider>
            <Init />
            <ThemeListener />
            <SiteHeader />
            <main className={styles.main}>{children}</main>
            <Player />
            <Toast />
            <CastManager />
          </TranslationProvider>
        </QueryProvider>
        <Script id="castsetup">
          {`window['__onGCastApiAvailable'] = function(isAvailable) {
            if (isAvailable && window.chrome && window.cast && window.chrome.cast && window.chrome.cast.media && window.cast.framework) {
              window.cast.framework.CastContext.getInstance().setOptions({
                receiverApplicationId: '5152FC99',
                autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
              });
              document.dispatchEvent(new CustomEvent('cast-available', {}));
            }
          };`}
        </Script>
        <Script src="//www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1" />
      </body>
    </html>
  );
}

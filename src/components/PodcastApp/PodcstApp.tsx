import { Fragment, useEffect } from 'react';
import { AppProps } from 'next/app';
import Head from 'next/head';
import { Header } from '../../ui/Header';
import { useGlobalShortcuts } from '../../shared/keyboard/useGlobalShortcuts';
import { removeDeprecatedStorage } from '../../shared/storage/storage';
import { SubscriptionsProvider } from '../../shared/subscriptions';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { PlayerProvider } from '../../shared/player/PlayerProvider';
import { Player } from '../../shared/player/Player';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(removeDeprecatedStorage, []);
  useGlobalShortcuts();
  return (
    <Fragment>
      <Head>
        <title>Podcst</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
        <meta name="theme-color" content="#212121" />
        <meta property="og:title" content="Podcst | Plays your favourite podcasts on all devices" />
        <meta property="og:site_name" content="Podcst" />
        <meta property="og:type" content="website" />
        <meta property="og:description" content="Plays your favourite podcasts on all devices" />
        <meta property="og:url" content="https://podcst.app" />
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
      <Header />

      <PlayerProvider>
        <main>
          <SubscriptionsProvider>
            <ThemeProvider>
              <Component {...pageProps} />
            </ThemeProvider>
          </SubscriptionsProvider>
        </main>
        <Player />
      </PlayerProvider>
    </Fragment>
  );
}

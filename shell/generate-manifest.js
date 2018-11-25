const { join } = require('path');
const { writeFileSync } = require('fs');

const outDir = join(process.cwd(), 'dist');
const outPath = join(outDir, 'manifest.json');

const appName = process.env.PODCST_APP || 'Podcst'
const baseUrl = process.env.PODCST_URL || 'play.podcst.io'

const templateManifest = {
  short_name: appName,
  name: appName,
  icons: [
    {
      src: `https://${baseUrl}/icons/launcher-72.png`,
      type: 'image/png',
      sizes: '72x72'
    },
    {
      src: `https://${baseUrl}/icons/launcher-96.png`,
      type: 'image/png',
      sizes: '96x96'
    },
    {
      src: `https://${baseUrl}/icons/launcher-144.png`,
      type: 'image/png',
      sizes: '144x144'
    },
    {
      src: `https://${baseUrl}/icons/launcher-192.png`,
      type: 'image/png',
      sizes: '192x192'
    },
    {
      src: `https://${baseUrl}/icons/launcher-512.png`,
      type: 'image/png',
      sizes: '512x512'
    }
  ],
  background_color: '#212121',
  theme_color: '#212121',
  display: 'standalone',
  start_url: '/feed/top'
};

const prettify = data => JSON.stringify(data, undefined, 2);

writeFileSync(outPath, prettify(templateManifest), 'utf-8');

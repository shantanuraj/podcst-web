const pkg = require('./package.json');

/**
 * @type {import('next').NextConfig}
 */
module.exports = {
  env: {
    appVersion: pkg.version,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        port: '',
        pathname: '**',
      },
    ],
  },
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    // TODO 2021-12-25 Remove when shopify-web-workers are fixed
    esmExternals: false,
    legacyBrowsers: false,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/feed/top',
        permanent: false,
      },
      {
        source: '/episode',
        destination: '/feed/top',
        permanent: false,
      },
      {
        source: '/episodes',
        destination: '/feed/top',
        permanent: false,
      },
    ];
  },
};

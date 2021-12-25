const package = require('./package.json');

/**
 * @type {import('next').NextConfig}
 */
module.exports = {
  env: {
    appVersion: package.version,
  },
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    // TODO 2021-12-25 Remove when shopify-web-workers are fixed
    esmExternals: false,
    legacyBrowsers: false,
    browsersListForSwc: true,
    runtime: 'nodejs'
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/feed/top',
        permanent: false,
      },
    ];
  },
};

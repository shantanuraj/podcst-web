const package = require('./package.json');

module.exports = {
  env: {
    appVersion: package.version,
  },
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    // TODO 2021-12-25 Remove when shopify-web-workers are fixed
    esmExternals: false,
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

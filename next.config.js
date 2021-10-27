const package = require('./package.json');

module.exports = {
  env: {
    appVersion: package.version,
  },
  reactStrictMode: true,
  swcMinify: true,
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

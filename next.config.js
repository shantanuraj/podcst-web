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
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
          },
        ],
      },
    ];
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

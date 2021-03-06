/**
 * Webpack configuration to build the project
 */

'use strict';

const { resolve } = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { GenerateSW } = require('workbox-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

const { version } = require('./package.json');
const generateManifest = require('./shell/generate-manifest');

const srcDir = resolve(__dirname, 'src');
const distDir = resolve(__dirname, 'dist');

const appUrl = 'https://' + (process.env.PODCST_URL || 'podcst.app');
// TODO: temp hack const cdnUrl = process.env.PODCST_URL ? appUrl.replace('play', 'static') : 'https://static.podcst.app';
const cdnUrl = 'https://podcst.app';

const routes = [
  {
    page: '/',
    title: 'Podcst',
  },
  {
    page: '/feed/top',
    title: 'Podcst - Top',
  },
  {
    page: '/episodes',
    title: 'Podcst - Feed',
  },
  {
    page: '/episode',
    title: 'Podcst - Episode',
  },
  {
    page: '/subs',
    title: 'Podcst - Subscriptions',
  },
  {
    page: '/settings',
    title: 'Podcst - Settings',
  },
  {
    page: '/recents',
    title: 'Podcst - Recents',
  },
];

const getPath = env => {
  const key = Object.keys(env)[0];
  if (key === 'dev') {
    return '/';
  } else {
    return cdnUrl + '/';
  }
};

generateManifest();

const generatePage = ({ page, title }) =>{
  const opts = {
    template: '../public/index.html',
    appUrl,
    cdnUrl,
    title
  };

  let path = page.slice(1);

  if (path) {
    opts.filename = `${path}/index.html`
  }

  return new HtmlWebpackPlugin(opts);
}

const pages = routes.map(generatePage);

module.exports = env => {
  const isProd = !!env.prod;
  const isStaging = !!env.staging;
  const isProdOrStaging = isProd || isStaging;

  const addPlugin = (add, plugin) => (add ? plugin : undefined);
  const removeEmpty = plugins => plugins.filter(plugin => !!plugin);
  const ifProd = plugin => addPlugin(isProdOrStaging, plugin);

  const output = {
    path: distDir,
    filename: '[name].js',
    chunkFilename: '[name].js',
    publicPath: getPath(env),
  };

  if (isProdOrStaging) {
    Object.assign(output, {
      filename: '[name]-[hash].js',
      chunkFilename: '[name]-[hash].js',
    });
  }

  return {
    mode: isProdOrStaging ? 'production' : 'development',
    optimization: {
      splitChunks: {
        chunks: 'initial',
      },
    },
    entry: {
      app: './index.tsx',
    },
    output,
    context: srcDir,
    devServer: {
      historyApiFallback: true,
    },
    devtool: isProdOrStaging ? 'source-map' : 'eval',
    resolve: {
      // Add `.ts` and `.tsx` as a resolvable extension.
      extensions: ['.webpack.js', '.web.js', '.ts', '.tsx', '.js', '.json'],
    },
    plugins: removeEmpty([
      new CleanWebpackPlugin('./dist'),
      new CopyWebpackPlugin([{ from: '../public' }]),
      new webpack.HashedModuleIdsPlugin(),
      new webpack.DefinePlugin({
        'process.env': {
          // Error logging
          APP_VERSION: `'${version}'`,
          IN_BROWSER: '"true"',
        },
      }),
      ifProd(
        new webpack.LoaderOptionsPlugin({
          minimize: true,
          debug: false,
        }),
      ),
      ...(isProd ? pages : pages.slice(0, 1)),
      ifProd(
        new GenerateSW({
          swDest: resolve(distDir, 'sw.js'),
          clientsClaim: true,
          skipWaiting: true,
          globIgnores: [ '**/now.json' ],
          navigateFallback: '/index.html',
          runtimeCaching: [
            {
              urlPattern: /.mp3(\?.*)?$/,
              handler: 'cacheFirst',
              options: {
                cacheName: 'podcasts',
                expiration: {
                  maxEntries: 20,
                },
                cacheableResponse: { statuses: [0, 299] },
              },
            },
            {
              urlPattern: /^https:\/\/data.podcst.io\/.*/,
              handler: 'staleWhileRevalidate',
              options: {
                cacheName: 'data-api',
              },
            },
          ],
        }),
      ),
      ifProd(
        new BundleAnalyzerPlugin({
          analyzerMode: 'static',
          openAnalyzer: false,
        }),
      ),
    ]),
    module: {
      rules: [
        // all files with a `.ts` or `.tsx` extension will be handled by `ts-loader`
        {
          test: /\.tsx?$/,
          use: [
            {
              loader: 'babel-loader',
              options: {
                cacheDirectory: true,
                plugins: ['@babel/plugin-proposal-class-properties', '@babel/plugin-transform-object-assign'],
                presets: [
                  [
                    '@babel/preset-env',
                    {
                      useBuiltIns: 'entry'
                    }
                  ]
                ],
              },
            },
            'ts-loader',
          ],
        },
        {
          test: /\.(png|woff|woff2|eot|ttf|svg)$/,
          use: [{ loader: 'url-loader?limit=100000' }],
        },
      ],
    },
  };
};

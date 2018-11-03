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
const WebpackHashOutput = require('webpack-plugin-hash-output');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const { version } = require('./package.json');

const getPath = env => {
  const key = Object.keys(env)[0];
  if (key === 'dev') {
    return '/';
  } else {
    return `https://static.podcst.io/${key}/`;
  }
};

const srcDir = resolve(__dirname, 'src');
const distDir = resolve(__dirname, 'dist');

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
    entry: {
      vendor: [
        'csstips',
        'howler',
        'react',
        'react-dom',
        'react-redux',
        'react-router-dom',
        'redux',
        'redux-observable',

        // Directly referenced Rx paackages
        'rxjs',
        'rxjs/ajax',
        'rxjs/operators',

        'typestyle',
      ],
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
      new WebpackHashOutput({
        manifestFiles: 'vendor',
      }),
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
      new HtmlWebpackPlugin({ template: '../public/index.html' }),
      ifProd(
        new GenerateSW({
          globDirectory: distDir,
          globPatterns: ['**/*.{html,js,css,svg}'],
          swDest: resolve(distDir, 'sw.js'),
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /.mp3(\?.*)?$/,
              handler: 'cacheFirst',
              options: {
                cacheName: 'podcasts',
                cacheExpiration: {
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
          openAnalyzer: true,
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
                plugins: ['transform-class-properties', 'transform-object-assign'],
                presets: ['env'],
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

const webpack = require('webpack');
const path = require('path');
const glob = require('glob');

const dir = path.resolve(process.cwd(), 'app/views');

module.exports = {
  webpack: (config, { dev }) => {
    config.module.rules.push(
      {
        test: /\.(css|scss)/,
        loader: 'emit-file-loader',
        options: {
          name: 'dist/[path][name].[ext]',
        },
      },
      {
        test: /\.css$/,
        use: [
          'babel-loader',
          'raw-loader',
          {
            loader: 'postcss-loader',
            options: {
              plugins: loader => [
                require('postcss-easy-import')({ prefix: '_' }),
                require('autoprefixer')(),
              ],
            },
          },
        ],
      },
      {
        test: /\.s(a|c)ss$/,
        use: [
          'babel-loader',
          'raw-loader',
          {
            loader: 'postcss-loader',
            options: {
              plugins: loader => [
                require('postcss-easy-import')({ prefix: '_' }),
                require('autoprefixer')(),
              ],
            },
          },
          {
            loader: 'sass-loader',
            options: {
              includePaths: ['styles', 'node_modules']
                .map(d => path.join(__dirname, d))
                .map(g => glob.sync(g))
                .reduce((a, c) => a.concat(c), []),
            },
          },
        ],
      },
      {
        test: /\.js(\?[^?]*)?$/,
        loader: 'babel-loader',
        include: [dir],
        exclude(str) {
          return /node_modules/.test(str);
        },
        options: {
          plugins: [
            [
              'module-resolver',
              {
                root: ['.'],
                alias: {
                  styles: './styles',
                  components: './components',
                  assets: './assets',
                  helpers: './helpers',
                },
                cwd: dir,
              },
            ],
            [
              'wrap-in-js',
              {
                extensions: ['css$', 'scss$'],
              },
            ],
          ],
          presets: ['next/babel'],
          ignore: [],
        },
      }
    );
    return config;
  },
};

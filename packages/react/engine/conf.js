const webpack = require('webpack');
const path = require('path');
const glob = require('glob');
const fs = require('fs');
const withSass = require('@zeit/next-sass');
const debug = require('debug')('henri:react');

const { cwd, pen } = henri;

const dir = path.resolve(cwd(), 'app/views');

let userConfig = null;

try {
  const configFilePath = path.resolve(cwd(), 'config', 'webpack.js');

  if (fs.existsSync(configFilePath)) {
    //eslint-disable-next-line global-require
    const conf = require(configFilePath);

    if (typeof conf.webpack === 'function') {
      userConfig = conf.webpack;
      debug('loaded webpack configuration file to extend next.js config');
    } else {
      pen.error(
        'react',
        `Can't load your config/webpack.js file. It should export a function.`
      );
    }
  } else {
    debug('no custom webpack.js found in the config folder');
  }
} catch (err) {
  debug('will not load nextjs local config');
  debug('error', err);
}

module.exports = withSass({
  sassLoaderOptions: {
    includePaths: ['styles', 'node_modules']
      .map((dir) => path.join(__dirname, dir))
      .map((gro) => glob.sync(gro))
      .reduce((arr, key) => arr.concat(key), []),
  },

  useFileSystemPublicRoutes: false,

  webpack: (config, { dev }) => {
    config.resolveLoader.modules.push(
      path.resolve(require.resolve('next'), '../../../..')
    );
    config.module.rules.push(
      {
        test: /\.s(a|c)ss$/,
        use: [
          {
            loader: 'sass-loader',
            options: {
              includePaths: ['styles', 'node_modules']
                .map((dir) => path.join(__dirname, dir))
                .map((glo) => glob.sync(glo))
                .reduce((arr, key) => arr.concat(key), []),
            },
          },
        ],
      },
      {
        exclude(str) {
          return /node_modules/.test(str);
        },
        include: [dir],
        test: /\.js(\?[^?]*)?$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
              ignore: [],
              plugins: [
                [
                  require.resolve('babel-plugin-module-resolver'),
                  {
                    alias: {
                      assets: './assets',
                      components: './components',
                      helpers: './helpers',
                      styles: './styles',
                    },
                    cwd: dir,
                    root: ['.'],
                  },
                ],
              ],
              presets: [require.resolve('next/babel')],
            },
          },
        ],
      }
    );
    if (userConfig) {
      config = userConfig(config, { dev }, webpack);

      if (
        !config ||
        !config.module ||
        !config.module.rules ||
        !config.resolveLoader
      ) {
        console.log('');
        pen.error(
          'react',
          'Seems like you removed stuff from your webpack configuration...'
        );
        pen.error('react', '');
        pen.error(
          'react',
          'Are you sure that you are returning the config passed as argument?'
        );
        pen.error('react', '');
        pen.error(
          'react',
          'Check the syntax of config/webpack.js. See below for a jQuery example:'
        );
        pen.error('react', '');
        pen.error('react', '    module.exports = {');
        pen.error('react', '      webpack: (config, { dev }, webpack) => {');
        pen.error('react', '        config.plugins.push(');
        pen.error('react', '          new webpack.ProvidePlugin({');
        pen.error('react', "            $: 'jquery',");
        pen.error('react', "            jQuery: 'jquery',");
        pen.error('react', '          })');
        pen.error('react', '        );');
        pen.error('react', '        return config;');
        pen.error('react', '      },');
        pen.error('react', '    };');
        pen.error('react', '');
        console.log('');
        process.exit(-1);
      }
    }

    return config;
  },
});

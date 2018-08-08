const webpack = require('webpack');
const path = require('path');
const glob = require('glob');
const withSass = require('@zeit/next-sass');

const { cwd, pen } = henri;

const dir = path.resolve(cwd(), 'app/views');

let userConfig = null;

try {
  const conf = require(path.resolve(cwd(), 'config', 'webpack.js'));
  if (typeof conf.webpack === 'function') {
    userConfig = conf.webpack;
  } else {
    pen.error(
      'react',
      `Can't load your config/webpack.js file. It should export a function.`
    );
  }
} catch (e) {}

module.exports = withSass({
  webpack: async (config, { dev }) => {
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
                .map(d => path.join(__dirname, d))
                .map(g => glob.sync(g))
                .reduce((a, c) => a.concat(c), []),
            },
          },
        ],
      },
      {
        test: /\.js(\?[^?]*)?$/,
        include: [dir],
        exclude(str) {
          return /node_modules/.test(str);
        },
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
              plugins: [
                [
                  require.resolve('babel-plugin-module-resolver'),
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
              ],
              presets: [require.resolve('next/babel')],
              ignore: [],
            },
          },
        ],
      }
    );
    if (userConfig) {
      config = await userConfig(config, { dev }, webpack);
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
        pen.error(
          'react',
          '      webpack: async (config, { dev }, webpack) => {'
        );
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
  sassLoaderOptions: {
    includePaths: ['styles', 'node_modules']
      .map(d => path.join(__dirname, d))
      .map(g => glob.sync(g))
      .reduce((a, c) => a.concat(c), []),
  },
  useFileSystemPublicRoutes: false,
});

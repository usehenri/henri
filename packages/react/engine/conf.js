const webpack = require('webpack');
const path = require('path');
const glob = require('glob');

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

module.exports = {
  webpack: async (config, { dev }) => {
    config = substituteReact(config);
    // config.resolveLoader.modules.push(path.resolve(__dirname, 'node_modules'));
    config.resolveLoader.modules.push(
      path.resolve(require.resolve('next'), '../../../..')
    );
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
          {
            loader: 'cache-loader',
            options: {
              cacheDirectory: path.resolve(dir, '.cache'),
            },
          },
          { loader: 'babel-loader', options: { cacheDirectory: true } },
          'raw-loader',
          {
            loader: 'postcss-loader',
            options: {
              plugins: loader => [
                require('cssnano')(),
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
          {
            loader: 'cache-loader',
            options: {
              cacheDirectory: path.resolve(dir, '.cache'),
            },
          },
          { loader: 'babel-loader', options: { cacheDirectory: true } },
          'raw-loader',
          {
            loader: 'postcss-loader',
            options: {
              plugins: loader => [
                require('cssnano')(),
                require('postcss-easy-import')({ prefix: '_' }),
                require('postcss-cssnext')(),
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
        include: [dir],
        exclude(str) {
          return /node_modules/.test(str);
        },
        use: [
          {
            loader: 'cache-loader',
            options: {
              cacheDirectory: path.resolve(dir, '.cache'),
            },
          },
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
                [
                  require.resolve('babel-plugin-wrap-in-js'),
                  {
                    extensions: ['css$', 'scss$'],
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
};

function substituteReact(config) {
  if (henri.config.get('renderer').toLowerCase() === 'preact') {
    if (!henri.isProduction) {
      pen.warn('react', `using React instead of preact for development`);
      return config;
    }
    config.resolve.alias = {
      react: 'preact-compat/dist/preact-compat',
      'react-dom': 'preact-compat/dist/preact-compat',
    };
    return config;
  }
  if (henri.config.get('renderer').toLowerCase() === 'inferno') {
    if (!henri.isProduction) {
      pen.warn('react', `using React instead of Inferno for development`);
      return config;
    }
    config.resolve.alias = {
      react: 'inferno-compat',
      'react-dom': 'inferno-compat',
    };
  }
  return config;
}

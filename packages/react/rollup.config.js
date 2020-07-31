import babel from '@rollup/plugin-babel';
var recursive = require('recursive-readdir');

async function getFiles() {
  const files = await recursive('src');

  return files;
}
const external = [
  '@babel/runtime/helpers/assertThisInitialized',
  '@babel/runtime/helpers/classCallCheck',
  '@babel/runtime/helpers/createClass',
  '@babel/runtime/helpers/defineProperty',
  '@babel/runtime/helpers/extends',
  '@babel/runtime/helpers/getPrototypeOf',
  '@babel/runtime/helpers/inherits',
  '@babel/runtime/helpers/objectWithoutProperties',
  '@babel/runtime/helpers/possibleConstructorReturn',
  '@babel/runtime/regenerator',
  '@babel/runtime/helpers/asyncToGenerator',
  'axios',
  'core-js',
  'react',
  'next/router',
  'prop-types',
  'shallowequal',
  'validator',
];

export default getFiles().then((files) =>
  files.map((name, index) => ({
    external,
    input: name,
    output: {
      dir: name.startsWith('src/forms') ? 'dist/lib/forms' : 'dist/lib',
      exports: 'named',
      format: 'cjs',
      name,
    },
    plugins: [
      babel({ babelHelpers: 'runtime', presets: ['@babel/preset-react'] }),
    ],
  }))
);

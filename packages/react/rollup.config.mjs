import { babel } from '@rollup/plugin-babel';

/**
 * Compiles src/ (ESM + JSX) to dist/lib (CommonJS), one output file per
 * source file so the package entry points (index.js, forms.js, withHenri.js)
 * can require them directly.
 */
export default {
  // Anything that is not a relative or absolute path is a dependency
  external: (id) => !id.startsWith('.') && !id.startsWith('/'),
  input: ['src/withHenri.js', 'src/paths.js', 'src/forms/index.js'],
  output: {
    dir: 'dist/lib',
    exports: 'named',
    format: 'cjs',
    preserveModules: true,
    preserveModulesRoot: 'src',
  },
  plugins: [
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      configFile: false,
      presets: [
        ['@babel/preset-env', { targets: { node: '22' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
    }),
  ],
};

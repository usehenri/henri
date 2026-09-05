// Tailwind CSS v4 runs as a PostCSS plugin under next.js, and next.js reads
// its PostCSS configuration from its root directory: app/views in a henri
// application (next.config.js and jsconfig.json live there too).
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

// Global styles must be imported from _app in next.js. index.css is the
// Tailwind CSS entry point of the application (see app/views/styles/index.css
// and app/views/postcss.config.mjs).
import '../styles/index.css';

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

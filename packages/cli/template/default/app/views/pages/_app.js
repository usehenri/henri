// Global styles must be imported from _app in next.js
import '../styles/index.scss';

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

const shell = require('../engine/shell');

describe('inertia shell helpers', () => {
  test('inject() fills the placeholders', () => {
    const html = shell.inject(
      '<html><head><!-- head --></head><body><!--body--></body></html>',
      { body: '<div id="app">$&</div>', head: '<title>t</title>' }
    );

    expect(html).toBe(
      '<html><head><title>t</title></head><body><div id="app">$&</div></body></html>'
    );
  });

  test('inject() falls back to the closing tags', () => {
    const html = shell.inject('<html><head></head><body></body></html>', {
      body: 'B',
      head: 'H',
    });

    expect(html).toBe('<html><head>H\n</head><body>B\n</body></html>');
  });

  test('pageJson() is safe inside a script element', () => {
    const json = shell.pageJson({
      props: { html: `</script><script>alert(1)</script> ${' '}` },
    });

    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c\\/script>');
    expect(json).toContain('\\u2028');
    expect(JSON.parse(json).props.html).toBe(
      `</script><script>alert(1)</script> ${' '}`
    );
  });

  test('clientBody() embeds the page object next to the root element', () => {
    const body = shell.clientBody('app', { component: 'index' });

    expect(body).toBe(
      '<script data-page="app" type="application/json">{"component":"index"}</script><div id="app"></div>'
    );
  });

  test('assetTags() lists the stylesheets, the entry and its chunks', () => {
    const tags = shell
      .assetTags(
        {
          '_shared.js': {
            css: ['assets/shared.css'],
            file: 'assets/shared.js',
            imports: ['_vendor.js'],
          },
          '_vendor.js': { file: 'assets/vendor.js', imports: ['_shared.js'] },
          'main.jsx': {
            css: ['assets/main.css'],
            dynamicImports: ['pages/index.jsx'],
            file: 'assets/main.js',
            imports: ['_shared.js'],
          },
          'pages/index.jsx': { file: 'assets/index.js' },
        },
        'main.jsx'
      )
      .split('\n');

    expect(tags).toEqual([
      '<link rel="stylesheet" href="/assets/main.css">',
      '<link rel="stylesheet" href="/assets/shared.css">',
      '<script type="module" src="/assets/main.js"></script>',
      '<link rel="modulepreload" href="/assets/shared.js">',
      '<link rel="modulepreload" href="/assets/vendor.js">',
    ]);
  });

  test('assetTags() complains about a missing entry', () => {
    expect(() => shell.assetTags({}, 'main.jsx')).toThrow(
      /not in the vite manifest/
    );
    expect(() => shell.assetTags(null, 'main.jsx')).toThrow(
      /not in the vite manifest/
    );
  });

  test('devTags() loads the entry from the dev server', () => {
    expect(shell.devTags('main.jsx')).toBe(
      '<script type="module" src="/main.jsx"></script>'
    );
  });

  test('devTags() links the stylesheets before the entry runs', () => {
    const tags = shell.devTags('main.jsx', ['/styles/index.css']);

    // ?direct asks vite for the css itself: without it the dev server hands
    // over a javascript module and the document paints unstyled first
    expect(tags).toContain(
      '<link rel="stylesheet" href="/styles/index.css?direct">'
    );
    expect(tags.indexOf('stylesheet')).toBeLessThan(tags.indexOf('<script'));
  });

  test('hash() is stable', () => {
    expect(shell.hash('a')).toBe(shell.hash('a'));
    expect(shell.hash('a')).not.toBe(shell.hash('b'));
    expect(shell.hash('a')).toHaveLength(32);
  });

  test('escapeHtml() escapes markup', () => {
    expect(shell.escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });
});

describe('the content security policy nonce', () => {
  const document = [
    '<!doctype html><html><head>',
    '<meta charset="utf-8">',
    '<link rel="icon" href="/favicon.ico">',
    '<link rel="stylesheet" href="/assets/app.css">',
    '<link rel="modulepreload" href="/assets/chunk.js" />',
    '<style>body{margin:0}</style>',
    '<script type="module">import "/@vite/client"</script>',
    '</head><body>',
    '<script data-page="app" type="application/json">{"props":{"a":">"}}</script>',
    '<div id="app"></div>',
    '<script nonce="already-there" src="/assets/app.js"></script>',
    '</body></html>',
  ].join('\n');

  test('writes the nonce on every script, style and stylesheet link', () => {
    const html = shell.withNonce(document, 'AbC-_123');
    const nonced = html.match(/nonce="AbC-_123"/gu) || [];

    // The two links that fetch, the style and the three scripts, less the
    // one that came with a nonce of its own
    expect(nonced).toHaveLength(5);
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/app.css" nonce="AbC-_123">'
    );
    expect(html).toContain(
      '<link rel="modulepreload" href="/assets/chunk.js" nonce="AbC-_123" />'
    );
    expect(html).toContain('<style nonce="AbC-_123">body{margin:0}</style>');
    expect(html).toContain(
      '<script type="module" nonce="AbC-_123">import "/@vite/client"</script>'
    );
    expect(html).toContain(
      '<script data-page="app" type="application/json" nonce="AbC-_123">'
    );
  });

  test('leaves alone what the policy does not cover, and what has one', () => {
    const html = shell.withNonce(document, 'AbC-_123');

    expect(html).toContain('<link rel="icon" href="/favicon.ico">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(
      '<script nonce="already-there" src="/assets/app.js">'
    );
  });

  test('leaves the document untouched without a nonce', () => {
    expect(shell.withNonce(document, null)).toBe(document);
    expect(shell.withNonce(document, '')).toBe(document);
  });

  // Vite's own runtime reads this meta: the <style> elements it injects in
  // development and the <link> elements __vitePreload appends in production
  // are written after the document is, so this is the only way they get one
  test('nonceMeta() is what vite reads at runtime', () => {
    expect(shell.nonceMeta('AbC-_123')).toBe(
      '<meta property="csp-nonce" nonce="AbC-_123">'
    );
    expect(shell.nonceMeta('"><script>')).not.toContain('<script>');
  });
});

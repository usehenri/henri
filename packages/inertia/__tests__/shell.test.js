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

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();

fs.copyFileSync(
  `${path.join(cwd, 'README.md')}`,
  `${path.join(cwd, 'packages/henri', 'README.md')}`
);

console.log('copied README.md over to henri');

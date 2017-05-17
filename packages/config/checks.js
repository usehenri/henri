const spawn = require('child_process').spawnSync;
const path = require('path');

const yarnExists = spawn('yarn', ['help']);

try {
  require.resolve(path.resolve(process.cwd(), 'node_modules', 'next'));
} catch (e) {
  console.log(
    `
    Unable to load 'next' from the current project.

    Try installing it:

    # ${yarnExists ? 'yarn add' : 'npm install'} next
    `
  );
  process.exit(-1);
}

try {
  require.resolve(path.resolve(process.cwd(), 'node_modules', 'react'));
  require.resolve(path.resolve(process.cwd(), 'node_modules', 'react-dom'));
} catch (e) {
  console.log(
    `
    Unable to load 'react' or 'react-dom' from the current project.

    Try installing it:

    # ${yarnExists ? 'yarn add' : 'npm install'} react react-dom
    `
  );
  process.exit(-1);
}

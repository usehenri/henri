const spawn = require('child_process').spawnSync;

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

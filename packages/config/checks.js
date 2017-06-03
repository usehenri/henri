const spawn = require('child_process').spawnSync;
const path = require('path');

const yarnExists = spawn('yarn', ['help']);

let missing = [];

const check = pkg => {
  try {
    require.resolve(path.resolve(process.cwd(), 'node_modules', pkg));
  } catch (e) {
    missing.push(pkg);
  }
};

check('next');
check('react');
check('react-dom');

if (missing.length > 0) {
  const multi = missing.length > 1;
  const listing = missing.join(' ');
  const msg = multi
    ? missing.map(
        (val, i) =>
          i === missing.length - 1 ? `\b\b and '${val}'` : `'${val}',`
      )
    : missing;
  console.log(
    `
    Unable to load ${msg.join(' ')} from the current project.

    Try installing ${multi ? 'them' : 'it'}:

    # ${yarnExists ? 'yarn add' : 'npm install'} ${missing.join(' ')}
    `
  );
  process.exit(-1);
}

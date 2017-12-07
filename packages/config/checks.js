const spawn = require('child_process').spawnSync;
const path = require('path');

const yarnExists = spawn('yarn', ['help']);

const { cwd, log } = henri;

const checkPackages = (packages = []) => {
  let missing = checkMissing(packages);

  if (missing.length > 0) {
    const msg = generateMessage(missing);
    /* istanbul ignore next */
    log.fatalError(`Unable to load ${msg.join(' ')} from the current project.
    
    Try installing ${missing.length > 1 ? 'them' : 'it'}:
    
      # ${yarnExists ? 'yarn add' : 'npm install'} ${missing.join(' ')}
    `);
  }
};

function checkMissing(packages) {
  let missing = [];

  for (let pkg of packages) {
    try {
      require.resolve(path.resolve(cwd, 'node_modules', pkg));
    } catch (e) {
      missing.push(pkg);
    }
  }
  return missing;
}

const generateMessage = missing => {
  if (missing.length > 1) {
    return missing.map(
      (val, i) => (i === missing.length - 1 ? `\b\b and '${val}'` : `'${val}',`)
    );
  }
  return missing;
};

henri.addModule('checkPackages', checkPackages);

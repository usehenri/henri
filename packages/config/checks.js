const spawn = require('child_process').spawnSync;
const path = require('path');

const yarnExists = spawn('yarn', ['help']);

const { cwd, log } = henri;

const checkPackages = packages => {
  let missing = [];

  if (!Array.isArray(packages)) {
    log.fatalError('checkPackages() should take an array...');
    return false;
  }

  for (let pkg of packages) {
    try {
      require.resolve(path.resolve(cwd, 'node_modules', pkg));
    } catch (e) {
      missing.push(pkg);
    }
  }

  if (missing.length > 0) {
    const multi = missing.length > 1;
    const msg = multi
      ? missing.map(
        (val, i) =>
          i === missing.length - 1 ? `\b\b and '${val}'` : `'${val}',`
      )
      : missing;

    log.fatalError(`Unable to load ${msg.join(' ')} from the current project.
    
    Try installing ${multi ? 'them' : 'it'}:
    
      # ${yarnExists ? 'yarn add' : 'npm install'} ${missing.join(' ')}
    `);
  }
};

henri.checkPackages = checkPackages;

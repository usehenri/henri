const spawn = require('child_process').spawnSync;
const path = require('path');

const yarnExists = spawn('yarn', ['help']);

const { cwd, log } = henri;

const checkPackages = packages => {
  let missing = [];

  if (!Array.isArray(packages)) {
    log.error('');
    log.error('checkPackages() should take an array...');
    log.error('');
    process.exit(-1);
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
    console.log('');
    log.error('');
    log.error(`Unable to load ${msg.join(' ')} from the current project.`);
    log.error('');
    log.error(`Try installing ${multi ? 'them' : 'it'}:`);
    log.error('');
    log.error(
      `# ${yarnExists ? 'yarn add' : 'npm install'} ${missing.join(' ')}`
    );
    log.error('');
    console.log('');
    process.exit(-1);
  }
};

henri.checkPackages = checkPackages;

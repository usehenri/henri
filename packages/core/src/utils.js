const _importFresh = require('import-fresh');
const spawn = require('cross-spawn');
const path = require('path');
const stack = require('callsite');

function importFresh(pkg) {
  return _importFresh(pkg);
}

const yarnExists = spawn.sync('yarn', ['help']);

function checkPackages(packages = []) {
  let missing = checkMissing(packages);

  if (missing.length > 0) {
    const msg = generateMessage(missing);
    /* istanbul ignore next */
    console.log(henri.log);
    henri.log.fatalError(`Unable to load ${msg.join(
      ' '
    )} from the current project.
    
    Try installing ${missing.length > 1 ? 'them' : 'it'}:
    
      # ${yarnExists ? 'yarn add' : 'npm install'} ${missing.join(' ')}
    `);
  }
}

function checkMissing(packages) {
  let missing = [];

  for (let pkg of packages) {
    try {
      require.resolve(path.resolve(henri.cwd, 'node_modules', pkg));
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

module.exports = { yarnExists, importFresh, checkPackages, stack };

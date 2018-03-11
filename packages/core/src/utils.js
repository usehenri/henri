const _importFresh = require('import-fresh');
const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');
const prettier = require('prettier');
const stack = require('callsite');
const readline = require('readline');

function importFresh(pkg) {
  return _importFresh(pkg);
}

const yarnExists = spawn.sync('yarn', ['help']);

function checkPackages(packages = []) {
  let missing = checkMissing(packages);

  if (missing.length > 0) {
    const msg = generateMessage(missing);
    /* istanbul ignore next */
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

function getColor(level) {
  const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    verbose: 'white',
    debug: 'blue',
    silly: 'magenta',
  };
  return colors[level.toLowerCase()] || 'red';
}

function clearConsole() {
  // Thanks to friendly-errors-webpack-plugin
  if (process.stdout.isTTY) {
    // Fill screen with blank lines. Then move to 0 (beginning of visible part) and clear it
    const blank = '\n'.repeat(process.stdout.rows || 1);
    console.log(blank); // eslint-disable-line no-console
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  }
}

async function syntax(location, onSuccess) {
  const { log } = this;
  return new Promise(resolve => {
    fs.readFile(location, 'utf8', (err, data) => {
      if (err) {
        log.error(`unable to check the syntax of ${location}`);
        return resolve(false);
      }
      parseSyntax(resolve, location, data, onSuccess);
    });
  });
}

function parseSyntax(resolve, file, data, onSuccess) {
  const { log } = this;
  try {
    prettier.format(data.toString(), {
      singleQuote: true,
      trailingComma: 'es5',
    });
    typeof onSuccess === 'function' && onSuccess();
    return resolve();
  } catch (e) {
    log.error(`while parsing ${file}`);
    console.log(' '); // eslint-disable-line no-console
    console.log(e.message); // eslint-disable-line no-console
    resolve();
  }
}

module.exports = {
  checkPackages,
  clearConsole,
  getColor,
  importFresh,
  stack,
  syntax,
  yarnExists,
};

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
    return `Unable to load ${msg.join(' ')} from the current project.
    
    Try installing ${missing.length > 1 ? 'them' : 'it'}:
    
      # ${yarnExists ? 'yarn add' : 'npm install'} ${missing.join(' ')}
    `;
  }
  return true;
}

function checkMissing(packages) {
  let missing = [];

  for (let pkg of packages) {
    try {
      require.resolve(path.resolve(process.cwd(), 'node_modules', pkg));
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

function getColor(level = 'error') {
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
  return true;
}

async function syntax(location, onSuccess) {
  return new Promise(resolve => {
    fs.readFile(location, 'utf8', (err, data) => {
      if (err) {
        return resolve(`unable to check the syntax of ${location}`);
      }
      parseSyntax(resolve, location, data, onSuccess);
    });
  });
}

function parseSyntax(resolve, file, data, onSuccess) {
  try {
    prettier.format(data.toString(), {
      singleQuote: true,
      trailingComma: 'es5',
    });
    typeof onSuccess === 'function' && onSuccess();
    return resolve();
  } catch (e) {
    console.log(`while parsing ${file}`); // eslint-disable-line no-console
    console.log(' '); // eslint-disable-line no-console
    console.log(e); // eslint-disable-line no-console
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

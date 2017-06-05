const nodemon = require('nodemon');

function main() {
  nodemon(
    '-e "js json" --ignore .tmp --ignore logs/ --ignore app/views --exec "henri start-henri"'
  );
}

module.exports = main;

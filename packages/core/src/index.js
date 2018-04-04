const Henri = require('./henri');

const func = new Henri();

async function start() {
  await func.init();
}

start();

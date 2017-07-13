henri.release = henri.version = require('./package.json').version;

henri.isProduction = process.env.NODE_ENV === 'production';

henri.isDev =
  process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

henri.isTest = process.env.NODE_ENV === 'test';

henri.cwd = process.cwd();

henri.getDiff = ms => Math.round(process.hrtime(ms)[1] / 1000000);

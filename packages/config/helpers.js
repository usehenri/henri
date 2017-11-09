henri.release = henri.version = require('./package.json').version;

henri.isProduction = process.env.NODE_ENV === 'production';

henri.isDev =
  process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

henri.isTest = process.env.NODE_ENV === 'test';

henri.cwd = process.cwd();

henri.getDiff = ms => {
  const diff = process.hrtime(ms);
  return Math.round(diff[0] * 1000 + diff[1] / 1e6);
};

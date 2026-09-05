const path = require('path');

const utils = require('../scripts/utils.js');

describe('cli utilities', () => {
  test('cwd returns correct directory', () => {
    expect(utils.cwd).toBe(process.cwd());
  });

  test('check looks for a file in the current directory', () => {
    expect(utils.check('package.json')).toBe(true);
    expect(utils.check('does-not-exist.json')).toBe(false);
  });

  test('pluralizes resource names', () => {
    expect(utils.pluralize('task')).toBe('tasks');
    expect(utils.pluralize('Category')).toBe('categories');
    expect(utils.pluralize('box')).toBe('boxes');
    expect(utils.pluralize('day')).toBe('days');
    expect(utils.pluralize('person')).toBe('people');
  });

  test('derives the names of a resource', () => {
    expect(utils.names('post')).toEqual({
      doc: 'Post',
      lower: 'post',
      plural: 'posts',
    });
    expect(utils.names('HighScore')).toEqual({
      doc: 'HighScore',
      lower: 'highscore',
      plural: 'highscores',
    });
  });

  test('reads the configuration the way core does', () => {
    const demo = path.resolve(__dirname, '../../demo');

    expect(utils.readConfig(demo, 'test').env).toBe('test');
    expect(utils.readConfig(demo, 'nothing').env).toBe('default');
    expect(utils.readConfig(path.resolve(__dirname), 'test')).toEqual({});
  });

  test('detects a git repository from a nested directory', () => {
    expect(utils.insideGit(__dirname)).toBe(true);
    expect(utils.insideGit(path.parse(__dirname).root)).toBe(false);
  });
});

const BaseModule = require('../base/module');
const Henri = require('../henri');
const Controllers = require('../2.controllers');

describe('controllers', () => {
  beforeAll(async () => {
    this.henri = new Henri({ runlevel: 2 });
    await this.henri.init();
  });

  afterAll(async () => {
    await this.henri.stop();
  });

  test('should be defined', () => {
    expect(this.henri.controllers).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.controllers).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const controllers = new Controllers();
    expect(controllers).toMatchSnapshot();
  });

  test('should load controllers and expose them', async () => {
    const mock = jest.fn();
    const controllers = {
      'someFolder/index': {
        index: () => mock,
        create: () => mock,
      },
      other: {
        update: () => mock,
        badStuff: 'really bad stuff',
      },
    };
    await this.henri.controllers.configure(controllers);
    expect(this.henri.controllers.get('someFolder/index#index')).toBeTruthy();
    expect(this.henri.controllers.get('someFolder/index#create')).toBeTruthy();
    expect(this.henri.controllers.get('other#update')).toBeTruthy();
    expect(this.henri.controllers.get('other#badStuff')).toBeUndefined();
  });

  test('should reload', () => {
    expect(this.henri.controllers.reload()).toBeTruthy();
  });

  test('should have get/set', () => {
    expect(this.henri.controllers.set('some#stuff', () => 'abc')).toBeTruthy();
    expect(this.henri.controllers.get('some#stuff')).toBeTruthy();

    expect(this.henri.controllers.set('some/stuff', 'abc')).toBeFalsy();
    expect(this.henri.controllers.get('some/stuff')).toBeFalsy();
  });

  xtest('should load filesystem structure');
  xtest('possibly freeze the private properties (this._controllers)');
});

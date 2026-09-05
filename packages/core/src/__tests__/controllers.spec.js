const BaseModule = require('../base/module');
const Henri = require('../henri');
const Controllers = require('../2.controllers');

let henri;

describe('controllers', () => {
  beforeAll(async () => {
    henri = new Henri({ runlevel: 2 });
    await henri.init();
  });

  afterAll(async () => {
    await henri.stop();
  });

  test('should be defined', () => {
    expect(henri.controllers).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.controllers).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const controllers = new Controllers();

    expect(controllers).toMatchSnapshot();
  });

  test('should load controllers and expose them', async () => {
    const mock = vi.fn();
    const controllers = {
      other: {
        badStuff: 'really bad stuff',
        update: () => mock,
      },
      'someFolder/index': {
        create: () => mock,
        index: () => mock,
      },
    };

    await henri.controllers.configure(controllers);

    expect(henri.controllers.get('someFolder/index#index')).toBeTruthy();
    expect(henri.controllers.get('someFolder/index#create')).toBeTruthy();
    expect(henri.controllers.get('other#update')).toBeTruthy();
    expect(henri.controllers.get('other#badStuff')).toBeUndefined();
  });

  test('should reload', () => {
    expect(henri.controllers.reload()).toBeTruthy();
  });

  test('should have get/set', () => {
    expect(henri.controllers.set('some#stuff', () => 'abc')).toBeTruthy();
    expect(henri.controllers.get('some#stuff')).toBeTruthy();

    expect(henri.controllers.set('some/stuff', 'abc')).toBeFalsy();
    expect(henri.controllers.get('some/stuff')).toBeFalsy();
  });
});

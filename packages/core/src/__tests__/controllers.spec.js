const init = require('../index');
const BaseModule = require('../base/module');

let henri = null;

describe('controllers', () => {
  beforeAll(async () => (henri = await init('.', 2)));

  test('should be defined', () => {
    expect(henri.controller).toBeDefined();
  });

  test('should has a private property on henri', () => {
    expect(henri.controllers).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.controller).toBeInstanceOf(BaseModule);
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

    expect(Object.keys(henri.controllers)).toHaveLength(0);
    await henri.controller.configure(controllers);
    expect(henri.controllers['someFolder/index#index']).toBeDefined();
    expect(henri.controllers['someFolder/index#create']).toBeDefined();
    expect(henri.controllers['other#update']).toBeDefined();
    expect(henri.controllers['other#badStuff']).toBeUndefined();
  });

  test('should reload', () => {
    expect(henri.controller.reload()).toBeTruthy();
  });

  xtest('should load filesystem structure');
});

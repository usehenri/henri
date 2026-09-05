const BaseModule = require('../base/module');
const Henri = require('../henri');
const Graphql = require('../1.graphql');

let henri;

describe('graphql', () => {
  beforeAll(async () => {
    henri = new Henri({ runlevel: 1 });
    await henri.init();
  });

  afterAll(async () => {
    await henri.stop();
  });

  test('should be defined', () => {
    expect(henri.graphql).toBeDefined();
    expect(1).toBeLessThan(3);
  });

  test('should extend BaseModule', () => {
    expect(henri.graphql).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const gql = new Graphql();

    expect(gql).toMatchSnapshot();
  });

  test('should load a new endpoint', () => {
    expect(henri.graphql.endpoint).toEqual('/_henri/graph');
  });

  describe('extract', () => {
    test('should have extract function', () => {
      expect(typeof henri.graphql.extract).toEqual('function');
    });

    test('should return false on empty models', () => {
      expect(henri.graphql.extract({ abc: 'd' })).toBeFalsy();
    });

    test('should extract from model', () => {
      const data = [
        {
          title: 'Le bonheur de vivre',
          year: 1905,
        },
        { title: 'Music', year: 1910 },
      ];

      const model = {
        graphql: {
          resolvers: { Query: { artworks: () => data } },
          types: `
            type Query { artworks: [Artwork], artwork: Artwork }
          `,
        },
      };

      henri.graphql.extract(model);
      henri.graphql.extract({
        graphql: { types: `type Artwork { title: String, year: Int }` },
      });
      henri.graphql.extract({
        graphql: { resolvers: { Query: { artwork: (key) => data[key] } } },
      });

      expect(henri.graphql.typesList).toEqual(
        expect.arrayContaining([model.graphql.types])
      );

      expect(henri.graphql.typesList).toEqual(
        expect.arrayContaining([`type Artwork { title: String, year: Int }`])
      );
    });
  });

  describe('merge', () => {
    test('should compile schema', async () => {
      expect(henri.graphql.typesList.length).toBeGreaterThan(0);
      expect(henri.graphql.schema).toBeNull();
      expect(henri.graphql.active).toBeFalsy();

      henri.graphql.merge();
      henri.graphql.init();

      expect(henri.graphql.schema).toBeTruthy();
      expect(henri.graphql.active).toBeTruthy();

      let result = await henri.graphql.run(`{ artworks { title, year }}`);

      expect(result).toMatchSnapshot();
    });

    test('should clear on reload', async () => {
      henri.graphql.reload();

      expect(henri.graphql.schema).toBeNull();
      expect(henri.graphql.active).toBeFalsy();

      henri.graphql.merge();

      expect(henri.graphql.schema).toBeNull();

      expect(henri.graphql.active).toBeFalsy();

      const result = await henri.graphql.run();

      expect(result).toEqual('No graphql schema found.');
    });
  });
});

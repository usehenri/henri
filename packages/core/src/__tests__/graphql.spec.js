const BaseModule = require('../base/module');
const Henri = require('../henri');
const Graphql = require('../1.graphql');

describe('graphql', () => {
  beforeAll(async () => {
    this.henri = new Henri({ runlevel: 1 });
    await this.henri.init();
  });

  afterAll(async () => {
    await this.henri.stop();
  });

  test('should be defined', () => {
    expect(this.henri.graphql).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.graphql).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const gql = new Graphql();

    expect(gql).toMatchSnapshot();
  });

  test('should load a new endpoint', () => {
    expect(this.henri.graphql.endpoint).toEqual('/_henri/graph');
  });

  describe('extract', () => {
    test('should have extract function', () => {
      expect(typeof this.henri.graphql.extract).toEqual('function');
    });

    test('should return false on empty models', () => {
      expect(this.henri.graphql.extract({ abc: 'd' })).toBeFalsy();
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

      this.henri.graphql.extract(model);
      this.henri.graphql.extract({
        graphql: { types: `type Artwork { title: String, year: Int }` },
      });
      this.henri.graphql.extract({
        graphql: { resolvers: { Query: { artwork: key => data[key] } } },
      });

      expect(this.henri.graphql.typesList).toEqual(
        expect.arrayContaining([model.graphql.types])
      );

      expect(this.henri.graphql.typesList).toEqual(
        expect.arrayContaining([`type Artwork { title: String, year: Int }`])
      );
    });
  });

  describe('merge', () => {
    test('should compile schema', async () => {
      expect(this.henri.graphql.typesList.length).toBeGreaterThan(0);
      expect(this.henri.graphql.schema).toBeNull();
      expect(this.henri.graphql.active).toBeFalsy();

      this.henri.graphql.merge();
      expect(this.henri.graphql.schema).toBeTruthy();
      expect(this.henri.graphql.active).toBeTruthy();

      let result = await this.henri.graphql.run(`{ artworks { title, year }}`);

      expect(result).toMatchSnapshot();
    });

    test('should clear on reload', async () => {
      this.henri.graphql.reload();

      expect(this.henri.graphql.schema).toBeNull();
      expect(this.henri.graphql.active).toBeFalsy();

      this.henri.graphql.merge();

      expect(this.henri.graphql.active).toBeFalsy();

      const result = await this.henri.graphql.run();

      expect(result).toEqual('No graphql schema found.');
    });
  });
});

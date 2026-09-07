/* global Article */
const Henri = require('../henri');

const {
  ATTACHED,
  INVALID,
  LIST,
  MODEL_API,
  RECORD_API,
  TAKEN,
  UNMERGEABLE,
  attach,
  conditionOf,
  enumsOf,
  nameOf,
} = require('../base/enums');

/** A model file with one enum column */
const model = (schema, name = 'Post') => ({
  globalId: name,
  identity: name.toLowerCase(),
  schema,
});

/** A model shaped the way `kindOf()` reads a Mongoose one */
const mongooseModel = (name = 'Post') => {
  const Model = function Mongoose() {};

  Model.modelName = name;
  Model.schema = {};
  Model.findOneAndUpdate = () => null;

  return Model;
};

/** ... and a Sequelize one, with the `Op` symbols of its connection */
const sequelizeModel = (Op, name = 'Post') => {
  const Model = function Sequelize() {};

  Model.modelName = name;
  Model.findByPk = () => null;
  Model.sequelize = { Sequelize: { Op } };

  return Model;
};

/** ... and a Drizzle one */
const drizzleModel = (name = 'Post') => {
  const Model = function Drizzle() {};

  Model.modelName = name;
  Model.fields = {};
  Model.table = {};
  Model.withDeleted = () => null;

  return Model;
};

/** What a declaration was refused with */
const refusalOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return `${error.code}: ${error.message}`;
  }

  return null;
};

const STATUS = {
  status: { enum: ['draft', 'live', 'archived'], type: 'string' },
  title: { type: 'string' },
};

describe('enum predicates and scopes', () => {
  describe('the name a value gives', () => {
    test('the four spellings of one word all answer the same name', () => {
      expect(nameOf('in_review')).toBe('inReview');
      expect(nameOf('in-review')).toBe('inReview');
      expect(nameOf('IN_REVIEW')).toBe('inReview');
      expect(nameOf('InReview')).toBe('inReview');
      expect(nameOf('inReview')).toBe('inReview');
    });

    test('a plain word is itself', () => {
      expect(nameOf('draft')).toBe('draft');
      expect(nameOf('USD')).toBe('usd');
      expect(nameOf('level_1')).toBe('level1');
    });

    test('a value that is not a name answers none', () => {
      expect(nameOf('2fa')).toBeNull();
      expect(nameOf('')).toBeNull();
      expect(nameOf('---')).toBeNull();
      expect(nameOf(3)).toBeNull();
      expect(nameOf(null)).toBeNull();
    });
  });

  describe('what a model declares', () => {
    test('one entry per enum column, with the two names of each value', () => {
      expect(enumsOf(model(STATUS))).toEqual([
        {
          field: 'status',
          methods: [
            { predicate: 'isDraft', scope: 'draft', value: 'draft' },
            { predicate: 'isLive', scope: 'live', value: 'live' },
            { predicate: 'isArchived', scope: 'archived', value: 'archived' },
          ],
          values: ['draft', 'live', 'archived'],
        },
      ]);
    });

    test('a model without one declares nothing', () => {
      expect(enumsOf(model({ title: { type: 'string' } }))).toBeNull();
      expect(enumsOf({})).toBeNull();
    });

    test('a value that is not a name is still a value, and gets no method', () => {
      const [column] = enumsOf(
        model({ kind: { enum: ['application/pdf', '2fa'], type: 'string' } })
      );

      expect(column.values).toEqual(['application/pdf', '2fa']);
      expect(column.methods.map((one) => one.scope)).toEqual([
        'applicationPdf',
      ]);
    });

    test('`predicates: false` keeps the values and generates no method', () => {
      const [column] = enumsOf(
        model({
          status: { enum: ['draft'], predicates: false, type: 'string' },
        })
      );

      expect(column.values).toEqual(['draft']);
      expect(column.methods).toEqual([]);
    });

    test('a string prefixes both halves', () => {
      const [column] = enumsOf(
        model({
          status: { enum: ['new'], predicates: 'status', type: 'string' },
        })
      );

      expect(column.methods).toEqual([
        { predicate: 'isStatusNew', scope: 'statusNew', value: 'new' },
      ]);
    });

    test('the schema is the source, not the validates block', () => {
      const [column] = enumsOf({
        ...model(STATUS),
        validates: { status: { enum: ['draft'] } },
      });

      expect(column.values).toEqual(['draft', 'live', 'archived']);
    });

    test('a `predicates` henri cannot read fails the boot', () => {
      expect(
        refusalOf(() =>
          enumsOf(model({ status: { enum: ['a'], predicates: 3, type: 'x' } }))
        )
      ).toBe(
        `${INVALID}: Post.status declares \`predicates: number\`, which is not a name`
      );
      expect(
        refusalOf(() =>
          enumsOf(
            model({ status: { enum: ['a'], predicates: '!!', type: 'x' } })
          )
        )
      ).toContain(INVALID);
    });
  });

  describe('what lands on the model', () => {
    let Post = null;

    beforeEach(() => {
      Post = mongooseModel();
      attach(Post, model(STATUS));
    });

    test('a predicate per value, on the record', () => {
      const post = Object.create(Post.prototype);

      post.status = 'draft';

      expect(post.isDraft()).toBe(true);
      expect(post.isLive()).toBe(false);
      expect(post.isArchived()).toBe(false);
    });

    test('a record whose column is empty answers false to all of them', () => {
      const post = Object.create(Post.prototype);

      expect(post.isDraft()).toBe(false);
      expect(post.isLive()).toBe(false);
    });

    test('a scope per value, answering a condition', () => {
      expect(Post.live()).toEqual({ status: 'live' });
      expect(Post.archived()).toEqual({ status: 'archived' });
    });

    test('a fresh condition every call, because an ORM casts one in place', () => {
      const first = Post.live();

      expect(Post.live()).not.toBe(first);
    });

    test('the value list, frozen', () => {
      expect(Post[LIST]).toEqual({ status: ['draft', 'live', 'archived'] });
      expect(Object.isFrozen(Post[LIST])).toBe(true);
      expect(Object.isFrozen(Post[LIST].status)).toBe(true);
    });

    test('nothing generated is enumerable', () => {
      expect(Object.keys(Post)).not.toContain('live');
      expect(Object.keys(Post)).not.toContain(LIST);
      expect(Object.keys(Post.prototype)).not.toContain('isLive');
    });

    test('a model with no enum column is left alone', () => {
      const Plain = mongooseModel('Plain');

      expect(attach(Plain, model({ title: { type: 'string' } }))).toBeNull();
      expect(Plain[LIST]).toBeUndefined();
    });

    test('a reload attaches again without colliding with itself', () => {
      expect(() => attach(Post, model(STATUS))).not.toThrow();
      expect(Post.live()).toEqual({ status: 'live' });
      expect(Post[ATTACHED].names.has('isLive')).toBe(true);
    });
  });

  describe('a scope composes, and can only narrow', () => {
    test('nothing given is the condition itself', () => {
      const Post = mongooseModel();

      attach(Post, model(STATUS));

      expect(Post.live(null)).toEqual({ status: 'live' });
      expect(Post.live(undefined)).toEqual({ status: 'live' });
    });

    test('an `and` on Mongoose and Drizzle, never a merge of keys', () => {
      const Post = mongooseModel();
      const Drizzle = drizzleModel();

      attach(Post, model(STATUS));
      attach(Drizzle, model(STATUS));

      expect(Post.live({ ownerId: 7 })).toEqual({
        $and: [{ ownerId: 7 }, { status: 'live' }],
      });
      expect(Drizzle.live({ ownerId: 7 })).toEqual({
        $and: [{ ownerId: 7 }, { status: 'live' }],
      });
    });

    test('a scope on the very column the enum names keeps both', () => {
      const Post = mongooseModel();

      attach(Post, model(STATUS));

      const merged = Post.live({ status: { $ne: 'archived' } });

      expect(merged.$and).toHaveLength(2);
      expect(merged.$and[1]).toEqual({ status: 'live' });
    });

    test('Sequelize gets the `Op.and` of its own connection', () => {
      const Op = { and: Symbol('and') };
      const Post = sequelizeModel(Op);

      attach(Post, model(STATUS));

      expect(Post.live({ ownerId: 7 })[Op.and]).toEqual([
        { ownerId: 7 },
        { status: 'live' },
      ]);
    });

    test('something that is not a condition is refused, not ignored', () => {
      const Post = mongooseModel();

      attach(Post, model(STATUS));

      expect(refusalOf(() => Post.live('everything'))).toContain(UNMERGEABLE);
      expect(refusalOf(() => Post.live(['draft']))).toContain(UNMERGEABLE);
      expect(refusalOf(() => Post.live(true))).toContain(UNMERGEABLE);
    });

    test('conditionOf is what a scope is made of', () => {
      const Post = mongooseModel();

      expect(conditionOf(Post, 'status', 'live', undefined)).toEqual({
        status: 'live',
      });
    });
  });

  describe('a name that is already something else', () => {
    test("`new` is refused, because `isNew` is the ORM's", () => {
      const Ticket = mongooseModel('Ticket');

      Ticket.prototype.isNew = true;

      expect(
        refusalOf(() =>
          attach(
            Ticket,
            model(
              { status: { enum: ['new', 'open'], type: 'string' } },
              'Ticket'
            )
          )
        )
      ).toBe(
        `${TAKEN}: Ticket: isNew() is part of what henri puts on a record, so the value "new" of status cannot generate it`
      );
    });

    test('... on every adapter, so a model that boots on one boots on the next', () => {
      // Sequelize instances have no `isNew`, and the refusal is the same
      const Ticket = sequelizeModel({ and: Symbol('and') }, 'Ticket');

      expect('isNew' in Ticket.prototype).toBe(false);
      expect(RECORD_API.has('isNew')).toBe(true);
      expect(
        refusalOf(() =>
          attach(
            Ticket,
            model({ status: { enum: ['new'], type: 'string' } }, 'Ticket')
          )
        )
      ).toContain(TAKEN);
    });

    test('a value whose scope is a method of the model is refused', () => {
      const Doc = mongooseModel('Doc');

      expect(MODEL_API.has('find')).toBe(true);
      expect(
        refusalOf(() =>
          attach(
            Doc,
            model({ state: { enum: ['find'], type: 'string' } }, 'Doc')
          )
        )
      ).toContain('find() is part of what henri puts on a model');
    });

    test("`name` and `length` are the function's own, and the `in` catches them", () => {
      const Doc = mongooseModel('Doc');

      expect(MODEL_API.has('name')).toBe(false);
      expect(
        refusalOf(() =>
          attach(
            Doc,
            model({ state: { enum: ['name'], type: 'string' } }, 'Doc')
          )
        )
      ).toContain('name() already exists on a model');
    });

    test('two values of one model that give one name are refused', () => {
      const Doc = mongooseModel('Doc');

      expect(
        refusalOf(() =>
          attach(
            Doc,
            model(
              { state: { enum: ['in_review', 'IN_REVIEW'], type: 'x' } },
              'Doc'
            )
          )
        )
      ).toContain('is already the one "in_review" of state generates');
    });

    test('two enum columns that give one name are refused too', () => {
      const Doc = mongooseModel('Doc');

      expect(
        refusalOf(() =>
          attach(
            Doc,
            model(
              {
                state: { enum: ['live'], type: 'string' },
                visibility: { enum: ['live'], type: 'string' },
              },
              'Doc'
            )
          )
        )
      ).toContain('is already the one "live" of state generates');
    });

    test('a predicate that is also a column of the model is refused', () => {
      const Doc = mongooseModel('Doc');

      expect(
        refusalOf(() =>
          attach(
            Doc,
            model(
              {
                isDraft: { type: 'boolean' },
                state: { enum: ['draft'], type: 'string' },
              },
              'Doc'
            )
          )
        )
      ).toContain('isDraft() is a column of this model');
    });

    test('the prefix is the way out, and it is the one the message names', () => {
      const Ticket = mongooseModel('Ticket');

      Ticket.prototype.isNew = true;
      attach(
        Ticket,
        model(
          {
            status: { enum: ['new', 'open'], predicates: 'status', type: 'x' },
          },
          'Ticket'
        )
      );

      const ticket = Object.create(Ticket.prototype);

      ticket.status = 'new';

      expect(ticket.isStatusNew()).toBe(true);
      expect(ticket.isNew).toBe(true);
      expect(Ticket.statusOpen()).toEqual({ status: 'open' });
      expect(Ticket[LIST].status).toEqual(['new', 'open']);
    });

    test('nothing is defined when a name is refused', () => {
      const Doc = mongooseModel('Doc');

      refusalOf(() =>
        attach(
          Doc,
          model({ state: { enum: ['draft', 'find'], type: 'string' } }, 'Doc')
        )
      );

      expect(Doc.draft).toBeUndefined();
      expect(Doc[LIST]).toBeUndefined();
      expect(Doc.prototype.isDraft).toBeUndefined();
    });
  });

  describe('on the demo application (disk store)', () => {
    const skipWorkers = process.env.SKIP_WORKERS;
    let henri = null;

    beforeAll(async () => {
      process.env.SKIP_WORKERS = '1';
      henri = new Henri();
      await henri.init();
      global.henri = henri;
    }, 60000);

    afterAll(async () => {
      await henri.stop();
      delete global.henri;
      if (typeof skipWorkers === 'undefined') {
        delete process.env.SKIP_WORKERS;
      } else {
        process.env.SKIP_WORKERS = skipWorkers;
      }
    }, 60000);

    test('the list of values is on the model', () => {
      expect(Article.enums).toEqual({
        status: ['draft', 'live', 'archived'],
      });
    });

    test('a predicate reads the record back', async () => {
      const article = await Article.create({ title: 'A draft of ours' });

      expect(article.status).toBe('draft');
      expect(article.isDraft()).toBe(true);
      expect(article.isLive()).toBe(false);

      article.status = 'live';
      await article.save();

      expect(article.isLive()).toBe(true);
    });

    test('a scope is a condition the adapter runs', async () => {
      const live = await Article.create({
        status: 'live',
        title: 'Published for the scope',
      });

      const found = await Article.find(Article.live());

      expect(found.map((one) => one.externalId)).toContain(live.externalId);
      expect(found.every((one) => one.isLive())).toBe(true);
    });

    test('and it narrows a condition rather than replacing it', async () => {
      const mine = await Article.create({
        status: 'live',
        title: 'Mine and live',
      });

      await Article.create({ status: 'draft', title: 'Mine and draft' });

      const found = await Article.find(
        Article.live({ title: { $in: ['Mine and live', 'Mine and draft'] } })
      );

      expect(found).toHaveLength(1);
      expect(found[0].externalId).toBe(mine.externalId);
    });

    test('a page of a scope, which is what an index writes', async () => {
      const { records, total } = await Article.paginate({
        page: 1,
        perPage: 2,
        where: Article.archived(),
      });

      expect(total).toBe(0);
      expect(records).toEqual([]);
    });
  });
});

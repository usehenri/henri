const { DataTypes } = require('sequelize');
const { normalizeSchema } = require('../schema');
const types = require('../types');

describe('schema normalizer', () => {
  test('maps the henri type names to sequelize data types', () => {
    const { attributes } = normalizeSchema({
      active: 'boolean',
      age: 'integer',
      birthday: { type: 'date' },
      id: 'uuid',
      name: { type: 'string' },
      notes: 'text',
      ratio: 'float',
      settings: 'json',
      weight: 'number',
    });

    expect(attributes.active.type).toBe(DataTypes.BOOLEAN);
    expect(attributes.age.type).toBe(DataTypes.INTEGER);
    expect(attributes.birthday.type).toBe(DataTypes.DATE);
    expect(attributes.id.type).toBe(DataTypes.UUID);
    expect(attributes.name.type).toBe(DataTypes.STRING);
    expect(attributes.notes.type).toBe(DataTypes.TEXT);
    expect(attributes.ratio.type).toBe(DataTypes.FLOAT);
    expect(attributes.settings.type).toBe(DataTypes.JSON);
    expect(attributes.weight.type).toBe(DataTypes.DOUBLE);
  });

  test('documents the same names as the types map', () => {
    expect(Object.keys(types).sort()).toEqual([
      'bigint',
      'boolean',
      'date',
      'decimal',
      'float',
      'integer',
      'json',
      'number',
      'string',
      'text',
      'uuid',
    ]);
  });

  test('accepts constructors, sequelize data types and nested documents', () => {
    const { attributes } = normalizeSchema({
      address: { city: String, street: String },
      code: DataTypes.STRING(10),
      count: Number,
      meta: {},
      name: String,
      raw: { type: DataTypes.TEXT },
      tags: [String],
      when: { type: 'DATEONLY' },
    });

    expect(attributes.address.type).toBe(DataTypes.JSON);
    expect(attributes.code.type).toBeInstanceOf(DataTypes.STRING);
    expect(attributes.count.type).toBe(DataTypes.DOUBLE);
    expect(attributes.meta.type).toBe(DataTypes.JSON);
    expect(attributes.name.type).toBe(DataTypes.STRING);
    expect(attributes.raw.type).toBe(DataTypes.TEXT);
    expect(attributes.tags.type).toBe(DataTypes.JSON);
    expect(attributes.when.type).toBe(DataTypes.DATEONLY);
  });

  test('translates required, default, unique and index', () => {
    const { attributes, indexes } = normalizeSchema({
      createdOn: { default: Date.now, type: 'date' },
      email: { type: 'string', unique: true },
      name: { required: true, type: 'string' },
      slug: { index: true, type: 'string' },
      status: { default: 'new', required: false, type: 'string' },
    });

    expect(attributes.name).toEqual({
      allowNull: false,
      type: DataTypes.STRING,
    });
    expect(attributes.status).toEqual({
      allowNull: true,
      defaultValue: 'new',
      type: DataTypes.STRING,
    });
    expect(attributes.email.unique).toBe(true);
    expect(attributes.createdOn.defaultValue).toBe(DataTypes.NOW);
    expect(attributes.slug).toEqual({ type: DataTypes.STRING });
    expect(indexes).toEqual([{ fields: ['slug'] }]);
  });

  test('uses ENUM where the dialect supports it and isIn elsewhere', () => {
    const schema = {
      category: { enum: ['urgent', 'low'], type: 'string' },
      level: { enum: [1, 2], type: 'integer' },
    };

    const postgres = normalizeSchema(schema, {
      dialect: 'postgres',
    }).attributes;
    const mysql = normalizeSchema(schema, { dialect: 'mysql' }).attributes;
    const sqlite = normalizeSchema(schema, { dialect: 'sqlite' }).attributes;
    const mssql = normalizeSchema(schema, { dialect: 'mssql' }).attributes;

    expect(postgres.category.type).toBeInstanceOf(DataTypes.ENUM);
    expect(postgres.category.type.values).toEqual(['urgent', 'low']);
    expect(mysql.category.type).toBeInstanceOf(DataTypes.ENUM);
    expect(sqlite.category.type).toBe(DataTypes.STRING);
    expect(sqlite.category.validate).toEqual({ isIn: [['urgent', 'low']] });
    expect(mssql.category.validate).toEqual({ isIn: [['urgent', 'low']] });
    expect(postgres.level.type).toBe(DataTypes.INTEGER);
    expect(postgres.level.validate).toEqual({ isIn: [[1, 2]] });
  });

  test('keeps sequelize attribute options', () => {
    const { attributes } = normalizeSchema({
      id: { autoIncrement: true, primaryKey: true, type: 'integer' },
      name: { allowNull: false, defaultValue: 'x', type: 'string' },
    });

    expect(attributes.id).toEqual({
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    });
    expect(attributes.name).toEqual({
      allowNull: false,
      defaultValue: 'x',
      type: DataTypes.STRING,
    });
  });

  test('takes the personal mark and keeps it out of the attribute', () => {
    const { attributes } = normalizeSchema({
      email: { personal: true, required: true, type: 'string', unique: true },
      phone: { personal: { expose: false }, type: 'string' },
    });

    // It is a mark for henri (core's base/privacy.js), not a column option
    expect(attributes.email).toEqual({
      allowNull: false,
      type: DataTypes.STRING,
      unique: true,
    });
    expect(attributes.phone).toEqual({ type: DataTypes.STRING });
  });

  test('throws on unknown keys and types', () => {
    expect(() =>
      normalizeSchema({ name: { type: 'string', validations: {} } })
    ).toThrow("Unknown key 'validations' on field 'name'");
    expect(() =>
      normalizeSchema({ name: { defaultsTo: 'x', type: 'string' } })
    ).toThrow("Unknown key 'defaultsTo' on field 'name'");
    expect(() => normalizeSchema({ name: { type: 'varchar' } })).toThrow(
      "Unknown type 'varchar' for field 'name'"
    );
    expect(() => normalizeSchema({ name: 'nope' })).toThrow(
      "Unknown type 'nope' for field 'name'"
    );
    expect(() => normalizeSchema({ name: { required: true } })).toThrow(
      "Field 'name' has 'required' but no type"
    );
    expect(() => normalizeSchema({ name: 42 })).toThrow(
      "Unsupported type 42 for field 'name'"
    );
  });
});

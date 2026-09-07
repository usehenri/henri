const { CHECKS, describe: line, lex, review, tokenOf } = require('../safety');
const target = require('./targets');

/**
 * What a migration would be reported as, on a dialect
 *
 * @param {string} sql The SQL
 * @param {string} dialect sqlite, postgres or mysql
 * @returns {Array<string>} `check table.column`, sorted
 */
const found = (sql, dialect) =>
  review(sql, { dialect }).map(
    (entry) =>
      `${entry.check} ${entry.table || '?'}${entry.column ? `.${entry.column}` : ''}`
  );

const DIALECTS = ['sqlite', 'postgres', 'mysql'];

describe('the scanner', () => {
  test('splits on the separator drizzle-kit writes, and on semicolons', () => {
    const written =
      'ALTER TABLE "a" DROP COLUMN "x";\n--> statement-breakpoint\nALTER TABLE "b" DROP COLUMN "y";';

    expect(lex(written).map((one) => one.text)).toEqual([
      'ALTER TABLE "a" DROP COLUMN "x"',
      'ALTER TABLE "b" DROP COLUMN "y"',
    ]);
    expect(found(written, 'postgres')).toEqual([
      'column.drop a.x',
      'column.drop b.y',
    ]);

    // A file with neither separator, which is what a hand-edited one looks
    // like: the semicolon is enough
    expect(
      found(
        'ALTER TABLE "a" DROP COLUMN "x"; ALTER TABLE "b" DROP COLUMN "y";',
        'postgres'
      )
    ).toEqual(['column.drop a.x', 'column.drop b.y']);
  });

  test('throws away what a string literal holds', () => {
    const [statement] = lex(
      `INSERT INTO "notes" ("body") VALUES ('DROP TABLE tasks');`
    );
    const strings = statement.tokens.filter((one) => one.kind === 'string');

    // Not "it is not matched": the token does not carry the text at all, so
    // nothing downstream is able to read a string as SQL
    expect(strings).toHaveLength(1);
    expect(strings[0].value).toBe('');
  });

  test.each(DIALECTS)(
    'a statement named inside a string is not one (%s)',
    (dialect) => {
      const quote = dialect === 'postgres' ? '"' : '`';

      expect(
        found(
          `INSERT INTO ${quote}notes${quote} (${quote}body${quote}) VALUES ('remember to DROP COLUMN done and DROP TABLE tasks');`,
          dialect
        )
      ).toEqual([]);
    }
  );

  test('a doubled quote does not end a string early', () => {
    expect(
      found(
        `INSERT INTO "notes" ("body") VALUES ('it''s fine; DROP TABLE tasks');`,
        'postgres'
      )
    ).toEqual([]);
  });

  test('a statement named inside a comment is not one', () => {
    expect(
      found(
        `-- DROP TABLE tasks; DROP COLUMN done
/* ALTER TABLE tasks DROP COLUMN done; */
ALTER TABLE "tasks" ADD COLUMN "note" varchar(255);`,
        'postgres'
      )
    ).toEqual([]);
  });

  test('a postgres block comment nests', () => {
    expect(
      found(
        '/* outer /* inner */ ALTER TABLE "tasks" DROP COLUMN "done"; */ ALTER TABLE "tasks" ADD COLUMN "n" integer;',
        'postgres'
      )
    ).toEqual([]);
  });

  test('a dollar-quoted body is one token, whatever it holds', () => {
    expect(
      found(
        `CREATE FUNCTION wipe() RETURNS void AS $body$
BEGIN
  DROP TABLE tasks;
  DELETE FROM notes;
END;
$body$ LANGUAGE plpgsql;`,
        'postgres'
      )
    ).toEqual([]);
  });

  test('mysql reads a double-quoted literal as a string, postgres as a name', () => {
    expect(
      found(
        'INSERT INTO `notes` (`body`) VALUES ("DROP TABLE tasks");',
        'mysql'
      )
    ).toEqual([]);

    // The same bytes on postgres: "DROP TABLE tasks" is an identifier there,
    // and still not a statement
    expect(
      found(`INSERT INTO notes (body) VALUES ("DROP TABLE tasks");`, 'postgres')
    ).toEqual([]);
  });

  test('a backslash does not end a mysql string', () => {
    expect(
      found(
        "INSERT INTO `notes` (`body`) VALUES ('a\\'; DROP TABLE tasks; --');",
        'mysql'
      )
    ).toEqual([]);
  });

  test('a column whose name reads like a statement is a column', () => {
    expect(
      found(
        'ALTER TABLE "tasks" ADD COLUMN "drop table" varchar(255);',
        'postgres'
      )
    ).toEqual([]);
    expect(
      found('ALTER TABLE "tasks" DROP COLUMN "drop table";', 'postgres')
    ).toEqual(['column.drop tasks.drop table']);
  });

  test('a qualified name answers the table it names', () => {
    expect(
      found('ALTER TABLE "public"."tasks" DROP COLUMN "done";', 'postgres')
    ).toEqual(['column.drop tasks.done']);
  });
});

describe('what is reported', () => {
  test('a table this migration created has no rows to lose', () => {
    expect(
      found(
        `CREATE TABLE "tmp" ("id" integer);
--> statement-breakpoint
ALTER TABLE "tmp" ADD COLUMN "n" integer NOT NULL;
--> statement-breakpoint
CREATE INDEX "tmp_n_idx" ON "tmp" ("n");
--> statement-breakpoint
DROP TABLE "tmp";`,
        'postgres'
      )
    ).toEqual([]);
  });

  test('the first migration of an application says nothing', () => {
    // The scaffolded shape: a table and the indexes beside it
    expect(
      found(
        `CREATE TABLE "tasks" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
	"name" varchar(255) NOT NULL,
	"external_id" uuid NOT NULL,
	CONSTRAINT "tasks_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE INDEX "tasks_slot_idx" ON "tasks" USING btree ("slot");`,
        'postgres'
      )
    ).toEqual([]);
  });

  test('a default is what makes a NOT NULL column safe', () => {
    expect(
      found(
        'ALTER TABLE "tasks" ADD COLUMN "note" varchar(255) NOT NULL;',
        'postgres'
      )
    ).toEqual(['column.not-null tasks.note']);
    expect(
      found(
        `ALTER TABLE "tasks" ADD COLUMN "note" varchar(255) DEFAULT 'x' NOT NULL;`,
        'postgres'
      )
    ).toEqual([]);
    expect(
      found('ALTER TABLE "tasks" ADD COLUMN "note" varchar(255);', 'postgres')
    ).toEqual([]);
  });

  test('CONCURRENTLY is the form that is not reported', () => {
    expect(found('CREATE INDEX "i" ON "tasks" ("n");', 'postgres')).toEqual([
      'index.build tasks',
    ]);
    expect(
      found('CREATE INDEX CONCURRENTLY "i" ON "tasks" ("n");', 'postgres')
    ).toEqual([]);
  });

  test('a WHERE inside a subquery does not bound the statement', () => {
    expect(
      found(
        'DELETE FROM "tasks" USING (SELECT id FROM notes WHERE x = 1) s;',
        'postgres'
      )
    ).toEqual(['data.unbounded tasks']);
    expect(
      found(
        'DELETE FROM "tasks" WHERE id IN (SELECT id FROM notes);',
        'postgres'
      )
    ).toEqual([]);
    expect(found('UPDATE "tasks" SET done = true;', 'postgres')).toEqual([
      'data.unbounded tasks',
    ]);
    expect(
      found('UPDATE "tasks" SET done = true WHERE id = 1;', 'postgres')
    ).toEqual([]);
  });

  test('dropping a constraint or an index takes nothing away from a row', () => {
    expect(
      found(
        'ALTER TABLE "tasks" DROP CONSTRAINT "tasks_note_unique";',
        'postgres'
      )
    ).toEqual([]);
    expect(
      found('ALTER TABLE `tasks` DROP INDEX `tasks_note_idx`;', 'mysql')
    ).toEqual([]);
  });

  test("sqlite's table rebuild is one finding, not a drop and a rename", () => {
    // What drizzle-kit writes for a column change on sqlite, which has no
    // ALTER COLUMN. Read one statement at a time it is a dropped table
    expect(
      found(
        `PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE \`__new_tasks\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`done\` integer
);
--> statement-breakpoint
INSERT INTO \`__new_tasks\`("id", "done") SELECT "id", "done" FROM \`tasks\`;
--> statement-breakpoint
DROP TABLE \`tasks\`;
--> statement-breakpoint
ALTER TABLE \`__new_tasks\` RENAME TO \`tasks\`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;`,
        'sqlite'
      )
    ).toEqual(['table.recreate tasks']);
  });

  test('a table really dropped is still a drop', () => {
    expect(found('DROP TABLE `tasks`;', 'sqlite')).toEqual([
      'table.drop tasks',
    ]);
    expect(found('DROP TABLE IF EXISTS "tasks";', 'postgres')).toEqual([
      'table.drop tasks',
    ]);
  });

  test('a rename is reported on both halves', () => {
    expect(
      found(
        `ALTER TABLE "tasks" RENAME COLUMN "done" TO "finished";
--> statement-breakpoint
ALTER TABLE "tasks" RENAME TO "todos";`,
        'postgres'
      )
    ).toEqual(['column.rename tasks.done', 'table.rename tasks']);
  });

  test('mysql MODIFY and CHANGE are read', () => {
    expect(
      found('ALTER TABLE `tasks` MODIFY COLUMN `done` int;', 'mysql')
    ).toEqual(['column.type tasks.done']);
    expect(
      found('ALTER TABLE `tasks` CHANGE COLUMN `done` `finished` int;', 'mysql')
    ).toEqual(['column.rename tasks.done', 'column.type tasks.done']);
  });

  test('several actions in one ALTER TABLE are read one at a time', () => {
    expect(
      found(
        'ALTER TABLE "tasks" ADD COLUMN "a" integer, DROP COLUMN "b", ADD CONSTRAINT "u" UNIQUE("a", "b");',
        'postgres'
      )
    ).toEqual(['column.drop tasks.b', 'index.build tasks']);
  });
});

describe('the dialect a check bites on', () => {
  // Measured, not assumed: `__tests__/engines.spec.js` runs these against a
  // real database. Here is only that the catalogue and the reader agree
  test('an index build is a postgres problem', () => {
    const sql = 'CREATE INDEX "i" ON "tasks" ("n");';

    expect(found(sql, 'postgres')).toEqual(['index.build tasks']);
    // MySQL 8 builds a secondary index online (ALGORITHM=INPLACE,
    // LOCK=NONE), and sqlite has no concurrent form to point at, so there
    // is no safe path to name on either
    expect(found('CREATE INDEX `i` ON `tasks` (`n`);', 'mysql')).toEqual([]);
    expect(found('CREATE INDEX `i` ON `tasks` (`n`);', 'sqlite')).toEqual([]);
  });

  test('a rebuild is a sqlite answer and nothing else has it', () => {
    const entry = CHECKS.find((one) => one.check === 'table.recreate');

    expect(entry.dialects).toEqual(['sqlite']);
  });

  test.each(DIALECTS)(
    'a dropped column is a problem everywhere (%s)',
    (dialect) => {
      const quote = dialect === 'postgres' ? '"' : '`';

      expect(
        found(
          `ALTER TABLE ${quote}tasks${quote} DROP COLUMN ${quote}done${quote};`,
          dialect
        )
      ).toEqual(['column.drop tasks.done']);
    }
  );

  test.each(DIALECTS)(
    'a NOT NULL column with no default is a problem everywhere (%s)',
    (dialect) => {
      const quote = dialect === 'postgres' ? '"' : '`';
      const column = dialect === 'postgres' ? 'ADD COLUMN' : 'ADD';

      expect(
        found(
          `ALTER TABLE ${quote}tasks${quote} ${column} ${quote}note${quote} varchar(255) NOT NULL;`,
          dialect
        )
      ).toEqual(['column.not-null tasks.note']);
    }
  );
});

describe('the catalogue', () => {
  test('is sorted, unique, and every check names a dialect', () => {
    const names = CHECKS.map((entry) => entry.check);

    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);

    for (const entry of CHECKS) {
      expect(entry.dialects.length).toBeGreaterThan(0);
      expect(entry.dialects.every((name) => DIALECTS.includes(name))).toBe(
        true
      );
      expect(entry.what.length).toBeGreaterThan(20);
      expect(entry.fix.length).toBeGreaterThan(40);
    }
  });

  test('every fix says what to do instead, not only what is wrong', () => {
    // The bar #414 set for every failure henri raises: a message that names
    // the danger and no way out is one a person cannot act on
    for (const entry of CHECKS) {
      expect(entry.fix).toMatch(
        /\b(Add|Ship|Create|Give|Give it|build|approve|Look at|Widening)\b/u
      );
      expect(entry.fix).not.toBe(entry.what);
    }
  });

  test('a finding carries the catalogue text with it', () => {
    const [entry] = review('ALTER TABLE "tasks" DROP COLUMN "done";', {
      dialect: 'postgres',
    });
    const known = CHECKS.find((one) => one.check === 'column.drop');

    expect(entry).toMatchObject({
      check: 'column.drop',
      column: 'done',
      fix: known.fix,
      table: 'tasks',
      what: known.what,
    });
    expect(line(entry)).toBe(`column.drop tasks.done: ${known.what}`);
  });
});

describe('the token', () => {
  const drop = review('ALTER TABLE "tasks" DROP COLUMN "done";', {
    dialect: 'postgres',
  });

  test('names the migration and what was found in it', () => {
    expect(tokenOf('0002_x', drop)).toMatch(/^0002_x:[0-9a-f]{12}$/u);
    expect(tokenOf('0003_x', drop)).not.toBe(tokenOf('0002_x', drop));
  });

  test('survives a file that was only reformatted', () => {
    const same = review(
      '-- what this does\nALTER TABLE "tasks"\n  DROP COLUMN "done";\n',
      { dialect: 'postgres' }
    );

    expect(tokenOf('0002_x', same)).toBe(tokenOf('0002_x', drop));
  });

  test('goes stale when another one of these is edited in', () => {
    const more = review(
      'ALTER TABLE "tasks" DROP COLUMN "done"; ALTER TABLE "tasks" DROP COLUMN "name";',
      { dialect: 'postgres' }
    );

    expect(tokenOf('0002_x', more)).not.toBe(tokenOf('0002_x', drop));
  });

  test('is a plain digest, so it means the same in every environment', () => {
    // Nothing keyed: a token is committed to the configuration and travels
    // to production, where config.secret does not
    expect(tokenOf('0002_x', drop)).toBe(tokenOf('0002_x', drop));
    expect(tokenOf('0002_x', drop)).toBe(
      tokenOf('0002_x', [
        { check: 'column.drop', column: 'done', table: 'tasks' },
      ])
    );
  });
});

describe('the target dialect reads its own migrations', () => {
  test('what drizzle-kit writes for this target is read back', () => {
    // A guard on the pairing rather than on the SQL: whichever database the
    // suite is pointed at, the quoting it uses is the quoting the scanner
    // was told about
    const quote = target.name === 'postgres' ? '"' : '`';

    expect(
      found(
        `ALTER TABLE ${quote}tasks${quote} DROP COLUMN ${quote}done${quote};`,
        target.name
      )
    ).toEqual(['column.drop tasks.done']);
  });
});

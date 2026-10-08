import { test } from 'node:test';
import { snippet } from './harness.mjs';

for (const scope of ['source.js', 'source.js.jsx', 'source.ts', 'source.tsx']) {
  const sfx = scope.replace('source.', '');

  test(`${scope}: sql tagged template`, async () => {
    const s = await snippet(scope, 'const q = sql`SELECT * FROM users WHERE id = ${id}`;\nconst x = 1;');
    s.sql('SELECT', 'keyword.other.DML.sql');
    s.sql('FROM', 'keyword.other.DML.sql');
    s.notSql('sql', `entity.name.function.tagged-template.${sfx}`);
    s.notSql('id', `variable.other.readwrite.${sfx}`, 1);
    s.notSql('x', `variable.other.constant.${sfx}`);
  });

  test(`${scope}: member and generic tags`, async () => {
    for (const code of ['db.sql`SELECT 1`', 'await Prisma.sql`SELECT 1`', 'sql<User>`SELECT 1`', 'SQL`SELECT 1`']) {
      const s = await snippet(scope, code + ';\nfoo();');
      s.sql('SELECT', 'keyword.other.DML.sql');
      s.notSql('foo');
    }
  });

  test(`${scope}: lowercase SQL in a tagged template`, async () => {
    const s = await snippet(scope, 'sql`select id from t`');
    s.sql('select', 'keyword.other.DML.sql');
  });

  test(`${scope}: /* sql */ comment tag`, async () => {
    const s = await snippet(scope, 'const q = /* sql */ `select 1`;');
    s.sql('select', 'keyword.other.DML.sql');
  });

  test(`${scope}: multi-line tagged template with interpolation inside a SQL string`, async () => {
    const s = await snippet(scope, [
      'const q = sql`',
      '  SELECT name',
      "  FROM users -- the table",
      "  WHERE name LIKE '%${term}%'",
      '`;',
      'call();',
    ].join('\n'));
    s.sql('SELECT', 'keyword.other.DML.sql');
    s.sql('the table', 'comment.line.double-dash.sql');
    s.sql('%', 'string.quoted.single.sql');
    s.notSql('term', `variable.other.readwrite.${sfx}`);
    s.notSql('call');
  });

  test(`${scope}: nested sql fragment in an interpolation`, async () => {
    const s = await snippet(scope, 'sql`SELECT * FROM t ${cond ? sql`WHERE a = ${b}` : sql``}`;\nnext();');
    s.sql('WHERE', 'keyword.other.DML.sql');
    s.notSql('b', `variable.other.readwrite.${sfx}`);
    s.notSql('next');
  });

  test(`${scope}: untagged template starting with a keyword`, async () => {
    const s = await snippet(scope, 'const q = `UPDATE t SET a = ${a}`;');
    s.sql('UPDATE', 'keyword.other.DML.sql');
    s.notSql('a', `variable.other.readwrite.${sfx}`, 1);
  });

  test(`${scope}: untagged template with the SQL on the next line`, async () => {
    const s = await snippet(scope, 'const q = `\n\n  SELECT 1\n  FROM t\n`;\nafter();');
    s.sql('SELECT', 'keyword.other.DML.sql');
    s.sql('FROM', 'keyword.other.DML.sql');
    s.notSql('after');
  });

  test(`${scope}: untagged multi-line template that isn't SQL stays a string`, async () => {
    const s = await snippet(scope, 'const msg = `\n  Hello ${name}\n  select a file\\n\n`;\nafter();');
    await s.noSql();
    s.notSql('Hello', `string.template.${sfx}`);
    s.notSql('name', `variable.other.readwrite.${sfx}`);
    s.notSql('\\n', `constant.character.escape.${sfx}`);
    s.notSql('after');
  });

  test(`${scope}: quoted strings starting with a keyword`, async () => {
    const s = await snippet(scope, `a("SELECT * FROM t WHERE n = 'x' -- c"); b('DELETE FROM t WHERE n = \\'x\\'');\ndone();`);
    s.sql('SELECT', 'keyword.other.DML.sql');
    s.sql('x', 'string.quoted.single.sql');
    s.sql('--', 'comment.line.double-dash.sql');
    s.sql(' c', 'comment.line.double-dash.sql');
    s.sql('DELETE', 'keyword.other.DML.sql');
    s.sql("\\'", `constant.character.escape.${sfx}`);
    s.notSql('b');
    s.notSql('done');
  });

  test(`${scope}: ordinary strings are untouched`, async () => {
    const s = await snippet(scope, `alert("Update failed"); log('select a row'); x = "SELECTED"; y = sqlite\`SELECT\`;`);
    await s.noSql();
  });

  test(`${scope}: strings and comments that merely contain SQL are untouched`, async () => {
    const s = await snippet(scope, `// SELECT * FROM t\n/* sql\`SELECT\` */\nx = "a 'SELECT' b";\ny = \`text \${"SELECT 1"}\`;`);
    s.notSql('a ');
    s.notSql(' SELECT * FROM t', 'comment.line.double-slash');
  });

  test(`${scope}: template nested in a multi-line interpolation`, async () => {
    const s = await snippet(scope, 'const line = `${a}${\n  b\n    ? `   |   ${c}`\n    : ""\n}`;\nconst x = 1;');
    await s.noSql();
  });

  test(`${scope}: SQL string inside an interpolation of an ordinary template`, async () => {
    const s = await snippet(scope, 'const t = `x ${db.query("SELECT 1 FROM t")} y`;\nnext();');
    s.sql('SELECT', 'keyword.other.DML.sql');
    s.notSql('next');
  });

  test(`${scope}: unbalanced quote in single-line string doesn't leak`, async () => {
    const s = await snippet(scope, `q = "SELECT 'oops";\nnext();`);
    s.sql('SELECT');
    s.notSql('next');
  });

  test(`${scope}: unbalanced quote in template doesn't leak`, async () => {
    const s = await snippet(scope, "q = sql`SELECT 'oops`;\nnext();");
    s.notSql('next');
  });
}

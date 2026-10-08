import { test } from 'node:test';
import { snippet } from './harness.mjs';

const py = (code) => snippet('source.python', code);

test('python: single and double quoted', async () => {
  const s = await py(`a = "SELECT * FROM t WHERE n = 'x'"\nb = 'DELETE FROM t -- gone'\nc = 1`);
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.sql('x', 'string.quoted.single.sql');
  s.sql('DELETE', 'keyword.other.DML.sql');
  s.sql(' gone', 'comment.line.double-dash.sql');
  s.notSql('"', 'string.quoted.single.python', 1);
  s.notSql('c', 'source.python');
});

test('python: triple quoted on the opening line', async () => {
  const s = await py('q = """SELECT id\n  FROM users\n  WHERE active"""\nnext_thing()');
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.sql('FROM', 'keyword.other.DML.sql');
  s.notSql('next_thing');
});

test('python: triple quoted with SQL on the next line', async () => {
  const s = await py(["q = '''", '', '    -- find people', '    SELECT name FROM people', "'''", 'x = 1'].join('\n'));
  s.sql('find people', 'comment.line.double-dash.sql');
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.notSql('x');
});

test('python: docstrings and prose stay strings', async () => {
  const s = await py('def f():\n    """\n    Select a row from the table.\n    """\n    return "Update failed"\n');
  await s.noSql();
});

test('python: prefixes', async () => {
  const s = await py(`a = r"SELECT '\\d'"\nb = u'UPDATE t'\nc = rb"SELECT"\nd = 1`);
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.notSql('r', 'storage.type.string.python');
  s.sql('UPDATE', 'keyword.other.DML.sql');
  // Bytes aren't SQL.
  s.notSql('SELECT', undefined, 1);
  s.notSql('d');
});

test('python: f-strings', async () => {
  const s = await py(`q = f"SELECT * FROM {table!r} WHERE id = {ids[0]} AND n LIKE '%{term}%' -- {{literal}}"\nafter = 1`);
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.notSql('table', undefined);
  s.notSql('ids');
  s.notSql('term');
  s.notSql('after');
});

test('python: multi-line f-string', async () => {
  const s = await py(['q = f"""', '    SELECT {cols}', '    FROM {table}', '"""', 'z = 2'].join('\n'));
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.notSql('cols');
  s.notSql('z');
});

test('python: escapes and an unbalanced quote', async () => {
  const s = await py(`a = "SELECT \\"x\\" FROM t WHERE a = 'oops"\nb = 2`);
  s.sql('\\"', 'constant.character.escape.python');
  s.notSql('b');
});

test('python: SQL on the line after an opening paren', async () => {
  const s = await py('cur.execute(\n    """\n    UPDATE t SET a = 1\n    """,\n    (1,),\n)\ny = 2');
  s.sql('UPDATE', 'keyword.other.DML.sql');
  s.notSql('y');
});

test('python: bracketed and statement-level strings keep their stock scopes', async () => {
  const s = await py('x = [\n    """\n    a\n    """,\n]\n"""\nModule notes.\n"""\nz = 3');
  await s.noSql();
});

test('python: a lone keyword is not SQL', async () => {
  const s = await py(`methods = {"GET", "DELETE"}\nname = 'SELECT'\nx = ("CREATE", 'WITH ')`);
  await s.noSql();
});

test('python: regex and docstring neighbours keep stock scopes', async () => {
  const s = await py([
    'def main():',
    '    """Small main program"""',
    '    usage = f"""usage: {sys.argv[0]} [-h]',
    '        -e: encode (default)"""',
    '    try:',
    '        pass',
    '    except E:',
    '        pass',
    '_OPT = r"""',
    '    (?P<option>.*?)\\s*$',
    '    """',
    'z = 1',
  ].join('\n'));
  await s.noSql();
});

test('python: %s placeholders and the --sql marker', async () => {
  const s = await py(`cur.execute("UPDATE users SET name = %s WHERE id = %(id)s", args)\nv = """--sql\n  VALUES (1, 2)\n"""\nw = 1`);
  s.sql('%s', 'constant.character.format.placeholder.other.python');
  s.sql('%(id)s', 'constant.character.format.placeholder.other.python');
  s.sql('VALUES', 'keyword.other');
  s.notSql('w');
});

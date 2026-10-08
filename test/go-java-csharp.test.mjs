import { test } from 'node:test';
import { snippet } from './harness.mjs';

test('go: raw and interpreted strings', async () => {
  const s = await snippet('source.go', [
    'rows, err := db.Query(`SELECT id FROM t WHERE n = $1`, n)',
    'q := `',
    '\tUPDATE t',
    '\tSET n = ? -- set it',
    '`',
    'x := "DELETE FROM t WHERE n = \\"a\\""',
    'msg := "Update failed"',
  ].join('\n'));
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.sql('UPDATE', 'keyword.other.DML.sql');
  s.sql(' set it', 'comment.line.double-dash.sql');
  s.sql('DELETE', 'keyword.other.DML.sql');
  s.sql('\\"', 'constant.character.escape.go');
  s.notSql('msg');
  s.notSql('Update failed', 'string.quoted.double.go');
});

test('go: struct tags and other raw strings untouched', async () => {
  const s = await snippet('source.go', 'type T struct {\n\tName string `json:"name"`\n}\nvar re = `\n^a+$\n`\n');
  await s.noSql();
});

test('java: strings and text blocks', async () => {
  const s = await snippet('source.java', [
    'String a = "SELECT * FROM t WHERE n = ?";',
    'String b = """',
    '    SELECT name',
    '    FROM people -- everyone',
    '    """;',
    'int c = 1;',
  ].join('\n'));
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.sql('FROM', 'keyword.other.DML.sql');
  s.sql(' everyone', 'comment.line.double-dash.sql');
  s.notSql('c');
});

test('java: ordinary text blocks untouched', async () => {
  const s = await snippet('source.java', 'String b = """\n    Hello there\n    """;\nint c = 1;');
  await s.noSql();
});

test('csharp: regular, verbatim, interpolated and raw strings', async () => {
  const s = await snippet('source.cs', [
    'var a = "SELECT * FROM t WHERE n = @n";',
    'var b = @"',
    '    UPDATE t SET n = ""x""',
    '    WHERE id = @id";',
    'var c = $"DELETE FROM {table} WHERE id = {{literal}}";',
    'var d = """',
    '    INSERT INTO t VALUES (1)',
    '    """;',
    'var e = $@"SELECT {col} FROM t";',
    'var f = 1;',
  ].join('\n'));
  s.sql('SELECT', 'keyword.other.DML.sql');
  s.sql('UPDATE', 'keyword.other.DML.sql');
  s.sql('""', 'constant.character.escape.cs');
  s.sql('DELETE', 'keyword.other.DML.sql');
  s.notSql('table');
  s.sql('INSERT', 'keyword.other.DML.sql');
  s.notSql('col');
  s.notSql('f');
});

test('csharp: ordinary strings untouched', async () => {
  const s = await snippet('source.cs', 'var a = "Update failed";\nvar b = @"C:\\path";\nvar c = $"Hi {name}";');
  await s.noSql();
});

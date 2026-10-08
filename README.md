# Sequel

**SQL highlighting inside your strings, for VS Code and Cursor.**

Atom used to highlight SQL wherever it showed up in your code: in a
`` sql`...` `` template, or in any string that started with `SELECT`. VS Code
shows those strings in one flat color. Sequel brings the old behavior back.

```ts
const user = await sql`
  SELECT id, name
  FROM users            -- comments work
  WHERE email = ${email} AND name LIKE '%${term}%'
`;
```

```python
cursor.execute("UPDATE users SET name = %s WHERE id = %s", (name, id))

query = f"""
    SELECT *
    FROM {table}
    WHERE created_at > now() - interval '1 day'
"""
```

The SQL is highlighted with VS Code's own SQL grammar, so it matches your
theme. Interpolations like `${email}` and `{table}` stay highlighted as code,
and so do escapes and `%s` placeholders.

## Install

Download `sequel-<version>.vsix` from the
[releases page](https://github.com/supreme/sequel/releases) and install it:

```sh
code --install-extension sequel-0.1.0.vsix     # VS Code
cursor --install-extension sequel-0.1.0.vsix   # Cursor
```

Or open the Extensions view, choose **Install from VSIX...** in the `...` menu,
and pick the file. Reload the window afterwards.

## What counts as SQL

A string is highlighted as SQL when it starts with one of these keywords and
there's more text after it:

`SELECT` `INSERT` `UPDATE` `DELETE` `CREATE` `ALTER` `DROP` `WITH` `REPLACE`
`MERGE` `TRUNCATE` `EXPLAIN` `GRANT` `REVOKE`

Keywords have to be uppercase, as they did in Atom. That keeps prose like
`"Update failed"` a plain string, and a lone word like the HTTP method
`"DELETE"` stays a plain string too.

A template tagged `sql` is always SQL, in any case: `` sql`select 1` `` works.

In a multi-line string the SQL can start on the line after the opening quote:

```go
rows, err := db.Query(`
    SELECT id FROM users WHERE org = $1
`, org)
```

For a multi-line string that doesn't start with a keyword, put a `--sql`
comment right after the opening quotes:

```python
rows = """--sql
    VALUES (1, 'one'), (2, 'two')
"""
```

## Supported languages

| Language | Strings |
| --- | --- |
| JavaScript, TypeScript, JSX, TSX | `` sql`...` `` (also `db.sql`, `Prisma.sql`, `sql<Row>`, `SQL`), `` /* sql */ `...` ``, untagged template literals, `'...'`, `"..."` |
| Python | `'...'`, `"..."`, `'''...'''`, `"""..."""` with `r`, `u`, `f`, `rf` prefixes |
| Go | `` `...` `` raw strings, `"..."` |
| Java | `"..."`, `"""` text blocks |
| C# | `"..."`, `@"..."`, `$"..."`, `$@"..."`, `"""..."""`, `$"""..."""` |

PHP and Ruby aren't in the list because VS Code already does this for them:
PHP strings that start with an SQL keyword and Ruby `<<~SQL` heredocs are
highlighted as SQL out of the box.

## Good to know

- Sequel is grammar-only: no code runs, nothing activates, and there are no
  settings.
- It never changes how the rest of your file is highlighted. SQL comments and
  quoted strings stop at the closing quote of the string they're in, so
  `"SELECT 1 -- note"` or an unbalanced `'` can't spill into the code after it.
- In Python, a triple-quoted string that starts its own line could be a
  docstring. So SQL on the line after the quotes is only detected when there's
  code before them (`q = """`, `execute("""`) or the string is a function
  argument.
- In Python, VS Code shows `r"""` with a lowercase `r` as a regular
  expression. Sequel leaves those alone unless the SQL starts on the same line
  as the quotes.

## Contributing

Bug reports and pull requests are welcome. If something gets highlighted
wrong, an issue with a short snippet that reproduces it is the most useful
thing you can send.

You'll need Node 20 or later and VS Code installed (the tests use its built-in
grammars).

```sh
git clone https://github.com/supreme/sequel.git
cd sequel
npm install
npm test
```

How it's put together:

- `scripts/build-grammars.mjs` generates everything in `syntaxes/` and the
  `contributes.grammars` section of `package.json`. Don't edit those by hand.
  Each kind of host string (a Python f-string, a Go raw string, and so on) is
  described once there and expanded into TextMate injection rules.
- `npm run build` regenerates the grammars. `npm test` builds, then tokenizes
  the snippets in `test/` with VS Code's real grammars, the same way the editor
  does. A snippet without SQL must tokenize exactly as it does without Sequel.
- `scripts/audit.mjs` runs the same check over a whole codebase and reports
  any line outside SQL whose highlighting changed. It's a good way to test a
  change against real code:

  ```sh
  node scripts/audit.mjs ~/src/some-project source.ts .ts .tsx
  ```

- `npm run package` runs the tests and builds `sequel-<version>.vsix`.
- `examples/` has a sample file per language for checking things by eye. Press
  F5 in VS Code to open them in a window with your working copy loaded.

The tests find VS Code in `/Applications` on macOS and `/usr/share/code` on
Linux. For anywhere else, set `VSCODE_EXTENSIONS` to its
`resources/app/extensions` directory.

## License

[MIT](LICENSE)

// Generates the injection grammars in syntaxes/ and the grammar contributions
// in package.json. Run with `npm run build`.
//
// Every host string kind is described once (how it opens and closes, which
// escapes and interpolations it has) and expanded into the same rule shapes:
//
//   immediate  the SQL starts on the opening line:   "SELECT ...",  sql`...`
//   deferred   a multi-line string whose first non-blank line starts with SQL:
//                  query = """
//                      SELECT ...
//              TextMate matches one line at a time, so the opening delimiter
//              is held open until the next non-blank line decides between an
//              SQL body and a plain host string.
//
// The SQL body is VS Code's own source.sql, preceded by the host's escapes and
// interpolations and by SQL comment/string rules that give up at the host's
// closing delimiter, so an unbalanced quote or a `--` comment cannot swallow
// the end of the string.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Uppercase only, as Atom did: "Update failed" or "select a file" stay strings.
const KEYWORDS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'WITH',
  'REPLACE', 'MERGE', 'TRUNCATE', 'EXPLAIN', 'GRANT', 'REVOKE',
];
const KW = `(?:${KEYWORDS.join('|')})\\b`;
// An explicit opt-in for SQL that doesn't start with a keyword: "--sql ...".
const MARKER = '--\\s*(?i:sql)\\b';
// A keyword alone ("DELETE" the HTTP method, 'SELECT' the IMAP command) isn't
// SQL: something has to follow it before the string closes, or the line ends.
const startsSql = (closeAhead) =>
  `(?=\\s*(?:${KW}(?:\\s+(?!${closeAhead})\\S|\\s*$)|${MARKER}))`;
// On the line after a bare opening delimiter any `--` comment counts as SQL.
const LINE_STARTS_SQL = `^(?=\\s*(?:${KW}|--))`;

const EMBEDDED = 'meta.embedded.block.sql';

const esc = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

// ---------------------------------------------------------------------------
// The SQL body, shared by every host.

function sqlBody(kind) {
  const { closeAhead, guts = [], interpolationStart } = kind;
  const stop = interpolationStart ? `${closeAhead}|${interpolationStart}` : closeAhead;
  const quoted = (q, name) => ({
    begin: esc(q),
    beginCaptures: { 0: { name: 'punctuation.definition.string.begin.sql' } },
    end: `(${esc(q)})(?!${esc(q)})|(?=${closeAhead})`,
    endCaptures: { 1: { name: 'punctuation.definition.string.end.sql' } },
    name,
    patterns: [
      ...guts,
      { match: esc(q + q), name: 'constant.character.escape.sql' },
    ],
  });
  const strings = [
    ["'", 'string.quoted.single.sql'],
    ['"', 'string.quoted.double.sql'],
    ['`', 'string.quoted.other.backtick.sql'],
  ]
    // A quote that is the host's own delimiter can only appear escaped, and the
    // guts above already consume the escape.
    .filter(([q]) => !kind.delimiters.includes(q))
    .map(([q, name]) => quoted(q, name));

  return [
    ...guts,
    {
      match: `(--)(?:(?!${stop}).)*`,
      name: 'comment.line.double-dash.sql',
      captures: { 1: { name: 'punctuation.definition.comment.sql' } },
    },
    {
      begin: '/\\*',
      beginCaptures: { 0: { name: 'punctuation.definition.comment.sql' } },
      end: `\\*/|(?=${closeAhead})`,
      endCaptures: { 0: { name: 'punctuation.definition.comment.sql' } },
      name: 'comment.block.sql',
      patterns: guts,
    },
    ...strings,
    { include: 'source.sql' },
  ];
}

// ---------------------------------------------------------------------------
// Rule shapes.

function delimiterScopes(kind) {
  return {
    begin: `${kind.stringScope} punctuation.definition.${kind.punctuation ?? 'string'}.begin.${kind.suffix}`,
    end: `${kind.stringScope} punctuation.definition.${kind.punctuation ?? 'string'}.end.${kind.suffix}`,
  };
}

function captures(kind, extra = {}) {
  const { begin } = delimiterScopes(kind);
  const caps = { ...extra };
  if (kind.prefixGroup) caps[kind.prefixGroup] = { name: `${kind.stringScope} storage.type.string.${kind.suffix}` };
  caps[kind.openGroup] = { name: begin };
  return caps;
}

function endRule(kind) {
  return {
    end: kind.close,
    endCaptures: { 1: { name: delimiterScopes(kind).end } },
  };
}

function immediate(kind, { begin = kind.open + startsSql(kind.closeAhead), beginCaptures } = {}) {
  return {
    begin,
    beginCaptures: beginCaptures ?? captures(kind),
    ...endRule(kind),
    contentName: `${EMBEDDED} meta.sequel.${kind.id}`,
    patterns: sqlBody(kind),
  };
}

function deferred(kind, { lead = '', open = kind.open } = {}) {
  return {
    begin: `${lead}${open}(?=\\s*$)`,
    beginCaptures: captures(kind),
    ...endRule(kind),
    // Scoped so the injection selector keeps us from reading the closing
    // delimiter as a new opening one.
    name: 'meta.sequel.deferred',
    patterns: [
      {
        begin: LINE_STARTS_SQL,
        end: `(?=${kind.closeAhead})`,
        contentName: `${EMBEDDED} meta.sequel.${kind.id}`,
        patterns: sqlBody(kind),
      },
      {
        begin: '^(?=\\s*\\S)',
        end: `(?=${kind.closeAhead})`,
        ...(kind.plainName === null ? {} : { name: kind.plainName ?? kind.stringScope }),
        patterns: kind.plainGuts ?? kind.guts ?? [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Hosts.

function javascript(lang, scope, suffix) {
  const template = {
    id: 'template',
    suffix,
    stringScope: `string.template.${suffix}`,
    punctuation: 'string.template',
    // Not right after an identifier: html`...` belongs to someone else.
    open: '(?<![_$[:alnum:]])(`)',
    openGroup: 1,
    close: '(`)',
    closeAhead: '`',
    delimiters: ['`'],
    interpolationStart: '\\$\\{',
    guts: [
      { include: `${scope}#template-substitution-element` },
      { include: `${scope}#string-character-escape` },
    ],
  };
  const quoted = (q, name) => ({
    id: name,
    suffix,
    stringScope: `string.quoted.${name}.${suffix}`,
    open: `(${q})`,
    openGroup: 1,
    close: `(${q})|(?<!\\\\)$`,
    closeAhead: `${q}|$`,
    delimiters: [q],
    guts: [{ include: `${scope}#string-character-escape` }],
  });
  const tag = `entity.name.function.tagged-template.${suffix}`;
  return {
    lang,
    scope,
    // Allow nested SQL inside an interpolation, but not inside SQL itself.
    exclude: `meta.template.expression.${suffix}`,
    embeddedLanguages: { [`meta.embedded.line.${suffix}`]: lang },
    patterns: [
      // sql`...`, db.sql`...`, Prisma.sql`...`, sql<Row>`...`
      immediate(template, {
        begin: `((?:[_$[:alpha:]][_$[:alnum:]]*\\s*\\??\\.\\s*)*)(sql|SQL)\\s*(<[^<>\`]*>)?\\s*(\`)`,
        beginCaptures: {
          2: { name: tag },
          4: { name: `${template.stringScope} punctuation.definition.string.template.begin.${suffix}` },
        },
      }),
      // /* sql */ `...`
      immediate(template, {
        begin: '(/\\*\\s*(?i:sql)\\s*\\*/)\\s*(`)',
        beginCaptures: {
          1: { name: `comment.block.${suffix}` },
          2: { name: `${template.stringScope} punctuation.definition.string.template.begin.${suffix}` },
        },
      }),
      immediate(template),
      deferred(template),
      immediate(quoted("'", 'single')),
      immediate(quoted('"', 'double')),
    ],
  };
}

function python() {
  const suffix = 'python';
  const prefixes = [
    { id: '', match: '[uU]?', raw: false, f: false },
    { id: 'raw', match: '[rR]', raw: true, f: false },
    { id: 'f', match: '[fF]', raw: false, f: true },
    { id: 'rawf', match: '[rR][fF]|[fF][rR]', raw: true, f: true },
  ];
  const quotes = [
    { q: '"""', multi: true },
    { q: "'''", multi: true },
    { q: '"', multi: false },
    { q: "'", multi: false },
  ];
  const patterns = [];
  const inArguments = [];
  for (const p of prefixes) {
    for (const { q, multi } of quotes) {
      const close = multi ? `(${q})` : `(${q})|(?<!\\\\)(?=\\n)`;
      const closeAhead = multi ? q : `${q}|\\n`;
      const lines = multi ? 'multi' : 'single';
      const guts = p.f
        ? [
            { include: `source.python#${p.raw ? 'fstring-raw-guts' : 'fstring-guts'}` },
            { match: '\\{\\{|\\}\\}', name: 'constant.character.escape.python' },
            {
              begin: '(\\{)',
              beginCaptures: { 1: { name: 'constant.character.format.placeholder.other.python' } },
              end: `(\\})|(?=${closeAhead})`,
              endCaptures: { 1: { name: 'constant.character.format.placeholder.other.python' } },
              name: 'meta.interpolation.sequel.python',
              patterns: [
                { include: `source.python#fstring-terminator-${lines}` },
                { include: 'source.python#f-expression' },
              ],
            },
          ]
        // %s, %(name)s and {name} placeholders, as in any Python string.
        : [{ include: `source.python#${p.raw ? 'string-raw-guts' : 'string-unicode-guts'}` }];
      // A multi-line string that turns out not to be SQL gets exactly the
      // rules MagicPython would have used. f-strings scope only their literal
      // text as a string (via the core rule), not the {expressions}.
      const raw = p.raw ? 'raw-' : '';
      const plainGuts = (p.f
        ? [`fstring-${raw}guts`, `fstring-illegal-${lines}-brace`, `fstring-${lines}-brace`, `fstring-${raw}${lines}-core`]
        : [
            `string-${lines}-bad-brace1-formatting-${p.raw ? 'raw' : 'unicode'}`,
            `string-${lines}-bad-brace2-formatting-${p.raw ? 'raw' : 'unicode'}`,
            p.raw ? 'string-raw-guts' : 'string-unicode-guts',
          ]
      ).map((rule) => ({ include: `source.python#${rule}` }));
      const quotedScope = `string.quoted.${p.raw ? 'raw.' : ''}${multi ? 'multi' : 'single'}.python`;
      const kind = {
        id: `python${p.id ? '.' + p.id : ''}.${multi ? 'multi' : 'single'}`,
        suffix,
        stringScope: p.f ? `string.interpolated.python ${quotedScope}` : quotedScope,
        open: `(?<![\\w])(${p.match})(${q})`,
        prefixGroup: 1,
        openGroup: 2,
        close,
        closeAhead,
        delimiters: [q[0]],
        interpolationStart: p.f ? '\\{(?!\\{)' : undefined,
        guts,
        plainGuts,
        plainName: p.f ? null : undefined,
      };
      patterns.push(immediate(kind));
      if (multi) {
        const variants = [{ kind, open: kind.open }];
        if (p.id === 'raw') {
          // MagicPython reads r'''...''' as a regular expression (R'''...'''
          // is a raw string), so if no SQL follows, fall back to its regex
          // rules rather than a plain raw string.
          const regex = {
            ...kind,
            stringScope: 'string.regexp.quoted.multi.python',
            plainGuts: [{ include: `source.python#${q[0] === '"' ? 'double' : 'single'}-three-regexp-expression` }],
          };
          variants.splice(0, 1, { kind, open: `(?<![\\w])(R)(${q})` }, { kind: regex, open: `(?<![\\w])(r)(${q})` });
        }
        for (const v of variants) {
          // A string that starts its own line may be a docstring, which
          // MagicPython wraps in an unnamed rule we can't see from a
          // selector, so wait for code before it: `q = """`, `execute("""`.
          patterns.push(deferred(v.kind, { open: v.open, lead: '(?<=\\S)[ \\t]*' }));
          // Call arguments can't hold docstrings, so there it's safe.
          inArguments.push(deferred(v.kind, { open: v.open }));
        }
      }
    }
  }
  return {
    lang: 'python',
    scope: 'source.python',
    exclude: 'meta.interpolation.sequel',
    // MagicPython names a whole f-string meta.fstring and scopes only its
    // literal text as a string, so its delimiters need excluding explicitly.
    alsoExclude: ['meta.fstring.python'],
    embeddedLanguages: { 'meta.interpolation.sequel.python': 'python' },
    patterns,
    extra: [{ id: 'arguments', within: 'meta.function-call.arguments.python', patterns: inArguments }],
  };
}

function go() {
  const suffix = 'go';
  const raw = {
    id: 'go.raw',
    suffix,
    stringScope: 'string.quoted.raw.go',
    open: '(`)',
    openGroup: 1,
    close: '(`)',
    closeAhead: '`',
    delimiters: ['`'],
  };
  const dq = {
    id: 'go.double',
    suffix,
    stringScope: 'string.quoted.double.go',
    open: '(")',
    openGroup: 1,
    close: '(")|(?<!\\\\)$',
    closeAhead: '"|$',
    delimiters: ['"'],
    guts: [{ include: 'source.go#string_escaped_char' }],
  };
  return {
    lang: 'go',
    scope: 'source.go',
    patterns: [immediate(raw), deferred(raw), immediate(dq)],
  };
}

function java() {
  const suffix = 'java';
  const escape = [{ match: '\\\\.', name: 'constant.character.escape.java' }];
  const dq = {
    id: 'java.double',
    suffix,
    stringScope: 'string.quoted.double.java',
    open: '(")',
    openGroup: 1,
    close: '(")|(?<!\\\\)$',
    closeAhead: '"|$',
    delimiters: ['"'],
    guts: escape,
  };
  // Text blocks must start with a line break, so they are only ever deferred.
  const block = {
    id: 'java.block',
    suffix,
    stringScope: 'string.quoted.triple.java',
    open: '(""")',
    openGroup: 1,
    close: '(""")',
    closeAhead: '"""',
    delimiters: ['"'],
    guts: escape,
  };
  return {
    lang: 'java',
    scope: 'source.java',
    patterns: [deferred(block), immediate(dq)],
  };
}

function csharp() {
  const suffix = 'cs';
  const stringScope = 'string.quoted.double.cs';
  const escape = { include: 'source.cs#string-character-escape' };
  const verbatimEscape = { include: 'source.cs#verbatim-string-character-escape' };
  const interpolation = { include: 'source.cs#interpolation' };
  const kinds = [
    // Raw strings first: at the same position `"""` must win over `"`.
    { id: 'cs.raw.interp', open: '(\\$""")', close: '(""")', closeAhead: '"""', guts: [{ include: 'source.cs#raw-interpolation' }], interp: true, multi: true },
    { id: 'cs.raw', open: '(""")', close: '(""")', closeAhead: '"""', guts: [], multi: true },
    { id: 'cs.verbatim.interp', open: '(\\$@"|@\\$")', close: '(")(?!")', closeAhead: '"(?!")', guts: [verbatimEscape, interpolation], interp: true, multi: true },
    { id: 'cs.verbatim', open: '(@")', close: '(")(?!")', closeAhead: '"(?!")', guts: [verbatimEscape], multi: true },
    { id: 'cs.interp', open: '(\\$")', close: '(")|$', closeAhead: '"|$', guts: [escape, interpolation], interp: true },
    { id: 'cs.double', open: '(")', close: '(")|$', closeAhead: '"|$', guts: [escape] },
  ];
  const patterns = [];
  for (const k of kinds) {
    const kind = {
      ...k,
      suffix,
      stringScope,
      openGroup: 1,
      delimiters: ['"'],
      interpolationStart: k.interp ? '\\{(?!\\{)' : undefined,
    };
    patterns.push(immediate(kind));
    if (k.multi) patterns.push(deferred(kind));
  }
  return {
    lang: 'csharp',
    scope: 'source.cs',
    // VS Code 1.140 renamed meta.interpolation.cs; match either.
    exclude: ['meta.interpolation.cs', 'meta.embedded.interpolation.cs'],
    embeddedLanguages: { 'meta.interpolation.cs': 'csharp', 'meta.embedded.interpolation.cs': 'csharp' },
    patterns,
  };
}

const HOSTS = [
  javascript('javascript', 'source.js', 'js'),
  javascript('javascriptreact', 'source.js.jsx', 'js.jsx'),
  javascript('typescript', 'source.ts', 'ts'),
  javascript('typescriptreact', 'source.tsx', 'tsx'),
  python(),
  go(),
  java(),
  csharp(),
];

// ---------------------------------------------------------------------------
// Output.

function selector(host, within) {
  // Not in comments or strings (an interpolation inside a string is fine), and
  // not inside SQL we already embedded unless we're in one of its
  // interpolations again. `-(X S)` covers a string nested inside an
  // interpolation, like the inner template in `${a ? `b` : c}`.
  const parts = [within ? `L:${host.scope} ${within}` : `L:${host.scope}`, '-comment'];
  if (host.exclude) {
    const interpolations = [host.exclude].flat();
    for (const scope of ['string', ...(host.alsoExclude ?? []), 'meta.sequel']) {
      parts.push(`-(${[scope, ...interpolations].join(' - ')})`);
      for (const interpolation of interpolations) parts.push(`-(${interpolation} ${scope})`);
    }
  } else {
    parts.push('-string', '-meta.sequel');
  }
  return parts.join(' ');
}

const outDir = join(root, 'syntaxes');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);

const grammars = [];
for (const host of HOSTS) {
  const name = host.scope.replace(/^source\./, '');
  for (const { id, within, patterns } of [{ patterns: host.patterns }, ...(host.extra ?? [])]) {
    const base = id ? `${name}.${id}` : name;
    const file = `sequel.${base}.tmLanguage.json`;
    const scopeName = `sequel.injection.${base}`;
    const grammar = {
      $comment: 'Generated by scripts/build-grammars.mjs; do not edit.',
      scopeName,
      injectionSelector: selector(host, within),
      patterns,
    };
    writeFileSync(join(outDir, file), JSON.stringify(grammar, null, 2) + '\n');
    grammars.push({
      injectTo: [host.scope],
      scopeName,
      path: `./syntaxes/${file}`,
      embeddedLanguages: { [EMBEDDED]: 'sql', ...host.embeddedLanguages },
    });
  }
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes = { ...pkg.contributes, grammars };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`wrote ${grammars.length} grammars to syntaxes/`);

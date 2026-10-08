// Tokenizes snippets with VS Code's built-in grammars plus our injections, the
// same way the editor does. Point VSCODE_EXTENSIONS at another install's
// resources/app/extensions directory to test against a different version.

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vsctm from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const extensionsDir = process.env.VSCODE_EXTENSIONS
  ?? [
    '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions',
    '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions',
    '/usr/share/code/resources/app/extensions',
  ].find(existsSync);
if (!extensionsDir) throw new Error('set VSCODE_EXTENSIONS to a VS Code resources/app/extensions directory');

const builtins = {
  'source.js': 'javascript/syntaxes/JavaScript.tmLanguage.json',
  'source.js.jsx': 'javascript/syntaxes/JavaScriptReact.tmLanguage.json',
  'source.js.regexp': 'javascript/syntaxes/Regular Expressions (JavaScript).tmLanguage',
  'source.ts': 'typescript-basics/syntaxes/TypeScript.tmLanguage.json',
  'source.tsx': 'typescript-basics/syntaxes/TypeScriptReact.tmLanguage.json',
  'source.python': 'python/syntaxes/MagicPython.tmLanguage.json',
  'source.regexp.python': 'python/syntaxes/MagicRegExp.tmLanguage.json',
  'source.go': 'go/syntaxes/go.tmLanguage.json',
  'source.java': 'java/syntaxes/java.tmLanguage.json',
  'source.cs': 'csharp/syntaxes/csharp.tmLanguage.json',
  'source.sql': 'sql/syntaxes/sql.tmLanguage.json',
};

const contributions = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).contributes.grammars;
const paths = { ...Object.fromEntries(Object.entries(builtins).map(([s, p]) => [s, join(extensionsDir, p)])) };
for (const g of contributions) paths[g.scopeName] = join(root, g.path);

const wasm = readFileSync(join(dirname(require.resolve('vscode-oniguruma')), 'onig.wasm')).buffer;
const onigLib = oniguruma.loadWASM(wasm).then(() => ({
  createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const makeRegistry = (injections) => new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName) => {
    const path = paths[scopeName];
    if (!path) return null;
    return vsctm.parseRawGrammar(readFileSync(path, 'utf8'), path);
  },
  getInjections: (scopeName) => injections
    ? contributions.filter((g) => g.injectTo.includes(scopeName)).map((g) => g.scopeName)
    : [],
});
const registries = { true: makeRegistry(true), false: makeRegistry(false) };

const loaded = new Map();
async function grammarFor(scopeName, injections) {
  const key = `${scopeName}:${injections}`;
  if (!loaded.has(key)) loaded.set(key, await registries[injections].loadGrammar(scopeName));
  return loaded.get(key);
}

/**
 * Tokenizes `code`, returning every token as { text, scopes, line }. With
 * `injections: false` it's VS Code without this extension.
 */
export async function tokenize(scopeName, code, { injections = true } = {}) {
  const grammar = await grammarFor(scopeName, injections);
  let stack = vsctm.INITIAL;
  const out = [];
  code.split('\n').forEach((line, i) => {
    const r = grammar.tokenizeLine(line, stack);
    for (const t of r.tokens) out.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes, line: i });
    stack = r.ruleStack;
  });
  return out;
}

/** Tokenized snippet with assertions phrased the way the tests read. */
export async function snippet(scopeName, code) {
  const tokens = await tokenize(scopeName, code);
  const find = (text, nth = 0) => {
    const hits = tokens.filter((t) => t.text.trim() === text || t.text.includes(text));
    const exact = tokens.filter((t) => t.text.trim() === text);
    const pick = (exact.length ? exact : hits)[nth];
    if (!pick) assert.fail(`no token "${text}" (#${nth}) in:\n${dump(tokens)}`);
    return pick;
  };
  const has = (t, scope) => t.scopes.some((s) => s === scope || s.startsWith(scope + '.') || s.split(' ').includes(scope));
  return {
    tokens,
    dump: () => dump(tokens),
    /** `text` is inside embedded SQL, optionally with a given SQL scope. */
    sql(text, scope, nth = 0) {
      const t = find(text, nth);
      assert.ok(has(t, 'meta.embedded.block.sql'), `"${text}" should be SQL:\n${dump(tokens)}`);
      if (scope) assert.ok(has(t, scope), `"${text}" should have ${scope}, got ${t.scopes.join(' ')}`);
    },
    /** `text` is not inside embedded SQL, optionally with a given host scope. */
    notSql(text, scope, nth = 0) {
      const t = find(text, nth);
      const innermost = t.scopes.lastIndexOf('meta.embedded.block.sql');
      const escaped = innermost >= 0 && t.scopes.slice(innermost).some((s) => /^meta\.(template\.expression|interpolation|embedded\.interpolation)\./.test(s));
      assert.ok(innermost < 0 || escaped, `"${text}" should not be SQL:\n${dump(tokens)}`);
      if (scope) assert.ok(has(t, scope), `"${text}" should have ${scope}, got ${t.scopes.join(' ')}`);
    },
    /** No SQL anywhere, and tokens exactly as VS Code produces without us. */
    async noSql() {
      const t = tokens.find((x) => x.scopes.includes('meta.embedded.block.sql'));
      assert.ok(!t, `expected no SQL, found "${t?.text}":\n${dump(tokens)}`);
      // Our marker scopes are invisible to themes; everything else must match,
      // whitespace included.
      const plain = (ts) => ts.map((x) => `${x.line} ${JSON.stringify(x.text)} ${x.scopes.filter((sc) => !sc.startsWith('meta.sequel.')).join(' ')}`);
      const stock = await tokenize(scopeName, code, { injections: false });
      assert.deepEqual(plain(tokens), plain(stock), 'tokens differ from stock VS Code');
    },
  };
}

function dump(tokens) {
  return tokens
    .filter((t) => t.text.trim())
    .map((t) => `  ${t.line}: ${JSON.stringify(t.text).padEnd(24)} ${t.scopes.slice(1).join(' ')}`)
    .join('\n');
}

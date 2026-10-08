// Tokenizes every file under a directory with and without the injections and
// reports lines that changed but contain no embedded SQL: a leak, where our
// rules swallowed or restructured code they shouldn't have.
//
//   node scripts/audit.mjs <dir> <source.scope> <ext>...
//   node scripts/audit.mjs ~/src/app source.ts .ts .mts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tokenize } from '../test/harness.mjs';

const [dir, scope, ...exts] = process.argv.slice(2);
const files = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (exts.includes(extname(name)) && st.size < 300_000) files.push(p);
  }
})(dir);

// String delimiters and prefixes on a line whose SQL starts below are scoped a
// little differently from stock (scope order, a missing meta.* wrapper) without
// changing their color, and whitespace isn't visible; neither counts.
const visible = (t) => t.text.trim() && !t.scopes.some((s) => /^(punctuation\.definition\.string|storage\.type\.string)/.test(s) || s.includes(' punctuation.definition.string'));
const strip = (t) => `${JSON.stringify(t.text)} ${t.scopes.filter((s) => !/^meta\.(sequel|fstring)\./.test(s)).join(' ')}`;
let sqlLines = 0, leaks = 0;
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  if (code.split('\n').some((l) => l.length > 3000)) continue; // minified
  const [ours, stock] = await Promise.all([tokenize(scope, code), tokenize(scope, code, { injections: false })]);
  const byLine = (ts) => ts.reduce((m, t) => ((m[t.line] ??= []).push(t), m), []);
  const a = byLine(ours), b = byLine(stock);
  a.forEach((line, i) => {
    if (line.some((t) => t.scopes.includes('meta.embedded.block.sql'))) return void sqlLines++;
    const x = line.filter(visible).map(strip).join('\n'), y = (b[i] ?? []).filter(visible).map(strip).join('\n');
    if (x !== y && leaks++ < 20) console.log(`LEAK ${file}:${i + 1}\n  ${code.split('\n')[i].trim().slice(0, 120)}`);
  });
}
console.log(`${files.length} files, ${sqlLines} SQL lines, ${leaks} leaked lines`);

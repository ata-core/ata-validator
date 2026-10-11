'use strict';

// The release job strips comments from the shipped JavaScript
// (scripts/strip-comments.js). It must remove comments and nothing else, keep
// every line where it was, and refuse a file where it would change a token.

const assert = require('assert');
const { strip, tokens, shippedFiles } = require('../scripts/strip-comments');

// Comment-like text inside strings, templates and regex literals stays.
const tricky = [
  "const a = 'http://x' // trailing",
  'const b = "/* not a comment */"',
  'const c = `line // kept\n/* kept */ ${1 /* gone */}`',
  'const d = /\\/\\/[^/]*/g.test(a) /* gone */',
  '/** JSDoc @param {string} x http://y */',
  'function f(x) { return x /* gone */ / 2 }',
  '/* a */ /* b */ const e = 1',
].join('\n');
const out = strip(tricky, 'tricky.js');
assert.strictEqual(out.split('\n').length, tricky.split('\n').length, 'every line stays');
assert.ok(out.includes("'http://x'") && out.includes('"/* not a comment */"'), 'strings stay');
assert.ok(out.includes('line // kept') && out.includes('/* kept */'), 'template text stays');
assert.ok(out.includes('/\\/\\/[^/]*/g'), 'regex literal stays');
assert.ok(!/gone|trailing|JSDoc|\/\* a \*\//.test(out), 'comments go: ' + out);
assert.strictEqual(tokens(out, 'tricky.js'), tokens(tricky, 'tricky.js'), 'same tokens');

// The token check catches a change to code, and ignores one to a comment.
const src = 'function g(a) {\n  // why\n  return a + 1 /* one */\n}\n';
assert.notStrictEqual(tokens(src.replace('a + 1', 'a - 1'), 'g.js'), tokens(src, 'g.js'));
assert.strictEqual(tokens(src.replace('// why', '// other'), 'g.js'), tokens(src, 'g.js'));

// Every shipped file strips cleanly, and lines stay put.
const fs = require('fs');
const path = require('path');
let files = 0;
for (const rel of shippedFiles()) {
  const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const stripped = strip(text, rel);
  assert.strictEqual(tokens(stripped, rel), tokens(text, rel), rel + ' keeps its tokens');
  assert.strictEqual(stripped.split('\n').length, text.split('\n').length, rel + ' keeps its lines');
  files++;
}
assert.ok(files > 50, 'the shipped file list is found');
console.log(`ok: comment stripping keeps tokens and lines in ${files} shipped files`);

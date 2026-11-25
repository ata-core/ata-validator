'use strict';

// plainLinear (lib/interpreter-core.js) decides which patterns the interpreted
// engines give to the platform RegExp. It used to tokenize with a sticky
// RegExp, whose first call in a process cost 100 to 160 microseconds; it now
// scans the characters in one loop. The old function is kept here as the
// oracle, and the two must accept the same patterns (see `same` below for
// groups, which the old one refused): every `pattern`
// and patternProperties key of the official test suite and of SchemaStore
// (when a checkout sits next to this repository), patterns put together from
// atoms, every short string over the characters the grammar turns on, and
// random strings of any characters.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { plainLinear } = require('../lib/engine-shared');
const { nativeIsLinear } = require('../lib/regex-linear');

const PLAIN_ATOM = /(?:\\[dDwWsS\\/.^$|?*+()[\]{}-]|\[\^?(?:[^\\\][^\ud800-\udfff]|\\[dws\\/.^$[\]-])(?:[^\\\][\ud800-\udfff]|\\[dws\\/.^$[\]-])*\]|[^\\[\](){}|*+?^$\ud800-\udfff])(\?|[*+]|\{(\d{1,3})(?:,(\d{1,3}))?\})?/y;
function oldPlainLinear(src) {
  const n = src.length, anchored = src[0] === '^';
  if (n > 256) return false;
  let i = anchored ? 1 : 0, choices = 1, loops = 0;
  while (i < n) {
    if (src[i] === '$' && i === n - 1) return true;
    PLAIN_ATOM.lastIndex = i;
    const m = PLAIN_ATOM.exec(src);
    if (m === null) return false;
    i = PLAIN_ATOM.lastIndex;
    const q = m[1];
    if (q === '?') choices *= 2;
    else if (q === '*' || q === '+') { if (!anchored || ++loops > 1) return false; }
    else if (q !== undefined) { const lo = +m[2], hi = m[3] === undefined ? lo : +m[3]; if (hi < lo) return false; choices *= hi - lo + 1; }
    if (choices > 64) return false;
  }
  return true;
}

// Whether the pattern opens a group (a `(` outside a class and not escaped)
// or has a `\u` escape.
function hasGroup(p) {
  for (let i = 0, inClass = false; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') { if (p[++i] === 'u') return true; }
    else if (inClass) { if (c === ']') inClass = false; }
    else if (c === '[') inClass = true;
    else if (c === '(') return true;
  }
  return false;
}

// The scanner also takes one level of group and `\uXXXX`, which the old
// tokenizer refused outright. So the two must agree on every pattern without
// either, and where they differ the old one refused, the pattern has one, and
// the code
// generator gives it a RegExp too (nativeIsLinear), so both engines answer
// with the same matcher. tests/test_regex_plain_linear.js holds the answers.
let compared = 0, accepted = 0, widened = 0;
const same = (p) => {
  const want = oldPlainLinear(p);
  const got = plainLinear(p);
  compared++;
  if (want) accepted++;
  if (got === want) return;
  if (want || !hasGroup(p)) assert.fail(`plainLinear(${JSON.stringify(p)}) is ${got}, the old tokenizer said ${want}`);
  if (!nativeIsLinear(p)) assert.fail(`plainLinear accepts ${JSON.stringify(p)}, which the code generator gives the linear engine`);
  widened++;
};

// Patterns in schemas.
const patterns = new Set();
const walk = (o) => {
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    if (k === 'pattern' && typeof o[k] === 'string') patterns.add(o[k]);
    if (k === 'patternProperties' && o[k] && typeof o[k] === 'object') for (const p of Object.keys(o[k])) patterns.add(p);
    walk(o[k]);
  }
};
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : []);
const suite = path.join(__dirname, 'suite', 'tests');
if (fs.existsSync(suite)) for (const f of files(suite)) walk(JSON.parse(fs.readFileSync(f, 'utf8')));
const fromSuite = patterns.size;
const store = path.join(__dirname, '..', '..', 'schemastore', 'src', 'schemas', 'json');
if (fs.existsSync(store)) for (const f of files(store)) { try { walk(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch {} }
const fromSchemas = patterns.size;
for (const p of patterns) same(p);

// Patterns put together from atoms, quantifiers and anchors.
let x = 2463534242;
const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ATOMS = ['a', 'b', '.', '-', ',', '/', ':', 'é', '\ud83d', '\udc00', '😀', '\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '\\.', '\\-', '\\^', '\\$', '\\\\', '\\/', '\\|', '\\?', '\\*', '\\+', '\\(', '\\)', '\\[', '\\]', '\\{', '\\}', '\\b', '\\B', '\\n', '\\u0041', '\\x41', '\\p{L}', '\\',
  '[a-z]', '[z-a]', '[^a]', '[\\d]', '[\\D]', '[\\w-]', '[\\W]', '[^\\S]', '[\\D\\d]', '[.]', '[\\]]', '[\\[]', '[-a]', '[^]', '[]', '[^^]', '[a^]', '[^a^]', '[0-9]', '[\\^]', '[\\$]', '[\\-]', '[\\\\]', '[\\/]', '[\\.]', '[\\n]', '[\\u0041]', '[a', '[\ud83d]', '[é]', '[[]', '[a[]', '[(]', '[)|*+?{}$]',
  '(a)', '(?:a)', 'a|b', '|', '(', ')', ']', '{', '}', '^', '$', '*', '+', '?',
  '(a|b)', '(/|\\./|[A-Za-z]:\\\\)', '(?:ab|c)', '(a|)', '(|a)', '()', '((a))', '(a*)', '(a?|b)', '(a{2}|b)', '(\\d|[x-z])', '(?=a)', '(?!a)', '(?<n>a)', '(a|b|c|d|e|f|g|h)', '(?:', '(a|b', '(^a)', '(a$)', '(.|\\.)',
  '\\u0000', '\\u00e9', '\\uFFFF', '\\uD83D', '\\udc00', '\\uD7FF', '\\uE000', '\\u12', '\\u00zz', '\\u+123', '\\u 123', '\\u', '[^\\u0000]', '[\\u0000-\\u001f]', '[a\\u0041]', '[\\ud800]', '[\\u004]', '(\\u0041|b)'];
const QUANTIFIERS = ['', '', '', '?', '*', '+', '{2}', '{1,3}', '{0,64}', '{64}', '{65}', '{0,63}', '{2,}', '{,2}', '{1000}', '{999}', '{007}', '{1,0}', '{3,1}', '{1,2', '{a}', '*?', '+?', '??', '?*', '{2}?', '{2}{3}'];
for (let k = 0; k < 300000; k++) {
  let p = rnd() < 0.5 ? '^' : '';
  const n = 1 + Math.floor(rnd() * 6);
  for (let j = 0; j < n; j++) p += pick(ATOMS) + pick(QUANTIFIERS);
  const r = rnd();
  if (r < 0.4) p += '$'; else if (r < 0.45) p += '$$'; else if (r < 0.5) p += '\\$';
  same(p);
}
// Long ones, around the 256 character limit.
for (const len of [255, 256, 257]) { same('a'.repeat(len)); same('^' + 'a'.repeat(len - 2) + '$'); same('^' + 'a'.repeat(len - 1)); }

// Every string up to length six over the characters the grammar turns on,
// in two alphabets so the count stays small.
const exhaust = (alphabet, max) => {
  const rec = (s) => { same(s); if (s.length < max) for (const ch of alphabet) rec(s + ch); };
  rec('');
};
exhaust(['\\', '[', ']', '^', '$', 'a', '-', 'd', '?', '+', '*'], 6);
exhaust(['{', '}', ',', '1', '0', '9', 'a', '^', '$', '?', '+'], 6);
exhaust(['(', ')', '|', '[', ']', '\\', '\ud83d', 'w', '.'], 5);

// Random strings of any characters.
const ANY = ['\\', '[', ']', '^', '$', '{', '}', ',', '(', ')', '|', '*', '+', '?', '-', '.', 'a', '0', '1', '2', 'd', 'w', 's', 'u', 'x', 'é', '\ud83d', '\ude00', ' ', '\u0000'];
for (let k = 0; k < 200000; k++) {
  let p = '';
  const n = Math.floor(rnd() * 12);
  for (let j = 0; j < n; j++) p += pick(ANY);
  same(p);
}

assert.ok(fromSuite > 20, `only ${fromSuite} patterns in the official suite; is tests/suite checked out?`);
assert.ok(accepted > 20000, `only ${accepted} patterns accepted; the inputs no longer exercise the rule`);
assert.ok(widened > 1000, `only ${widened} patterns with a group accepted; the inputs no longer exercise the group rule`);
assert.strictEqual(plainLinear('^(/|\\./|[A-Za-z]:\\\\)?[a-z]+$'), true);
for (const p of ['^(/|\\./|[A-Za-z]:\\\\)?[^\\u0000]+$', '^[^\\u0000]+$', '\\u0041', '[\\uE000-\\uFFFF]']) assert.strictEqual(plainLinear(p), true, p);
for (const p of ['\\uD83D', '[\\udfff]', '\\u12', '[\\u00zz]', '\\u+123', '\\u0x12', '^\\u']) assert.strictEqual(plainLinear(p), false, p);
for (const p of ['^((a|b))$', '^(a|)$', '^(a*|b)$', '^(a|b)*$', '^(a|b){2}$', '^(a|b)??$', '(?=a)', '^(?!a)', '^(a|b', 'a|b', '^(a$)']) assert.strictEqual(plainLinear(p), false, p);
console.log(`ok: plainLinear agrees with the old tokenizer on ${compared} patterns (${fromSuite} from the suite, ${fromSchemas - fromSuite} from SchemaStore), ${accepted} accepted by both, ${widened} more with a group or \\u, all native in generated code`);

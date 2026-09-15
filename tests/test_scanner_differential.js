// The scanner reads JSON itself, so it can be wrong in the one direction that
// does not produce a bug report: accepting a document `validate()` rejects, or
// one `JSON.parse` would have refused outright. This holds the two to the same
// answer on the same text.
//
// Three corpora:
//   1. every case of the official suite, all three dialects, for every schema
//      the scanner agrees to compile
//   2. malformed and adversarial JSON text, where the answer must match
//      "JSON.parse throws" exactly
//   3. generated text, valid documents and single-character corruptions of them
//
// A bail (-1) is not a disagreement: it is the scanner declining, and the
// caller then parses. Only a 1 where the reference says false, or a 0 where it
// says true, is a failure.

const fs = require('fs');
const path = require('path');
const { Validator } = require('../index');
const { compileScanner } = require('../lib/scan-compiler');

let compiled = 0, declined = 0, cases = 0, bails = 0;
const failures = [];

function check(label, text, validator) {
  let refValid;
  try {
    refValid = validator.validate(JSON.parse(text)).valid;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    refValid = false; // unparseable text is not a valid document
  }
  let got;
  try {
    got = validator._scanner(text);
  } catch (e) {
    failures.push(`${label}: scanner threw ${e.message} on ${JSON.stringify(text).slice(0, 120)}`);
    return;
  }
  cases++;
  if (got === -1) { bails++; return; }
  const scanValid = got === 1;
  if (scanValid !== refValid) {
    failures.push(`${label}: scanner says ${scanValid}, validate says ${refValid} for ${JSON.stringify(text).slice(0, 160)}`);
  }
}

// A validator plus its scanner, or null when the schema is out of scope.
function prepare(schema) {
  let v, sc;
  try {
    v = new Validator(schema);
    sc = compileScanner(v._schemaObj !== undefined ? v._schemaObj : schema, { userFormats: v._userFormats });
  } catch {
    return null;
  }
  if (!sc) { declined++; return null; }
  compiled++;
  v._scanner = sc.scan;
  return v;
}

// ---------------------------------------------------------------------------
// 1. the official suite
const DIALECTS = ['draft2020-12', 'draft7', 'v1'];
for (const dialect of DIALECTS) {
  const dir = path.join(__dirname, 'suite/tests', dialect);
  if (!fs.existsSync(dir)) continue;
  const files = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  })(dir);
  for (const file of files) {
    let groups;
    try { groups = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const group of groups) {
      const v = prepare(group.schema);
      if (!v) continue;
      for (const t of group.tests) {
        let text;
        try { text = JSON.stringify(t.data); } catch { continue; }
        if (text === undefined) continue;
        check(`${dialect}/${path.basename(file)}/${group.description}/${t.description}`, text, v);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. malformed and adversarial text
const MALFORMED = [
  '', ' ', '{', '}', '[', ']', '{}}', '[][]', '{"a":1', '{"a":}', '{:1}', '{"a" 1}',
  '{"a":1,}', '[1,]', '[,1]', '{,"a":1}', '01', '1.', '.1', '+1', '1e', '1e+', '-',
  'tru', 'truex', 'nul', 'nulll', 'False', 'NaN', 'Infinity', '-Infinity',
  '"unterminated', '"bad\\escape"', '"\\u12"', '"\\u12g4"', '"\\x41"',
  '"rawcontrol"', '{"a":1}{"b":2}', '[1] ', ' [1]', '﻿{}', "{'a':1}",
  '{"a":01}', '{"a":-}', '{"a":1e999}', '{"a":1E+3}', '{"a":"\\ud800"}',
  '{"a":"\\ud800\\udc00"}', '[[[[[[[[[[1]]]]]]]]]]', '{"a":{"a":{"a":1}}}',
  '{"a":1,"a":2}', '{"\\u0061":1}', '{"a" : \t 1 \n }', '[ ]', '{ }', '"\\/"',
  '0', '-0', '0.0e0', '123456789012345678901234567890', '[1,2,3]\n',
];
const PERMISSIVE = [
  true,
  {},
  { type: 'object' },
  { type: 'object', additionalProperties: true },
  { type: 'object', properties: { a: {} } },
  { type: 'array' },
  { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
  { type: 'object', properties: { a: { type: 'integer', minimum: 0 } }, required: ['a'] },
  { type: 'object', properties: { a: { type: 'string', minLength: 1, maxLength: 3 } } },
  { type: 'string' },
  { type: 'number' },
  { type: 'integer' },
];
for (const schema of PERMISSIVE) {
  const v = prepare(schema);
  if (!v) continue;
  for (const text of MALFORMED) check(`malformed/${JSON.stringify(schema)}`, text, v);
}

// ---------------------------------------------------------------------------
// 3. generated documents and single-character corruptions
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260915);
function randomValue(depth) {
  const r = rng();
  if (depth > 2 || r < 0.3) {
    const k = rng();
    if (k < 0.15) return null;
    if (k < 0.3) return rng() < 0.5;
    if (k < 0.55) return Math.floor(rng() * 400) - 200;
    if (k < 0.7) return (rng() * 1000 - 500) / 7;
    const pool = ['', 'a', 'hello', 'a"b', 'tab\there', 'nl\nhere', 'éç', '😀', 'a\\b', 'x', 'x'.repeat(40)];
    return pool[Math.floor(rng() * pool.length)];
  }
  if (r < 0.65) {
    const o = {};
    const keys = ['a', 'b', 'id', 'name', 'age', 'active', 'email', 'xé', 'q"q'];
    const n = Math.floor(rng() * 5);
    for (let k = 0; k < n; k++) o[keys[Math.floor(rng() * keys.length)]] = randomValue(depth + 1);
    return o;
  }
  const a = [];
  const n = Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) a.push(randomValue(depth + 1));
  return a;
}
const GEN_SCHEMAS = [
  true,
  false,
  {},
  { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 10 }, active: { type: 'boolean' } }, required: ['id'] },
  { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number', maximum: 100 } }, additionalProperties: false },
  { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'integer' } },
  { type: 'array', items: { type: 'object', properties: { age: { type: 'integer', minimum: 0, maximum: 150 } } }, minItems: 0, maxItems: 4 },
  { type: 'object', properties: { s: { type: 'string', enum: ['a', 'hello', 'a"b'] } } },
  { type: 'object', properties: { s: { type: 'string', const: 'hello' } } },
  { type: 'object', properties: { s: { type: 'string', pattern: '^[a-z]+$' } } },
  { type: 'object', properties: { n: { type: 'number', multipleOf: 0.5 } } },
  { type: ['object', 'null'] },
  { type: ['string', 'number', 'boolean'] },
  { enum: [1, 'a', null, true] },
  { const: 42 },
  { enum: [] },
  // the counting rule: only safe where every name is a known name
  { type: 'object', additionalProperties: false, properties: { a: {}, b: {}, c: {} }, minProperties: 1, maxProperties: 2 },
  // nesting, so the emitted code is nested too
  { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'array', items: { type: 'object', properties: { c: { type: 'string', minLength: 2 } }, required: ['c'] } } } } } },
  // every name in required is a name the object dispatch has to know
  { type: 'object', required: ['a', 'b'], additionalProperties: { type: 'integer' } },
  { type: 'object', properties: { 'q"q': { type: 'string' }, 'x\u00e9': { type: 'number' } } },
  { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
  { type: 'string', minLength: 1, maxLength: 3 },
  { type: 'string', format: 'email' },
  { type: 'string', format: 'date-time' },
  { type: 'string', format: 'uri' },
  { type: 'string', format: 'uuid' },
  { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 },
  { type: 'number', minimum: -1.5, maximum: 1.5 },
  // references are inlined, so the property names here are the ones the
  // generator actually emits: a reference nobody reaches proves nothing
  { $ref: '#/$defs/user', $defs: { user: { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1 } }, required: ['id'] } } },
  { type: 'object', properties: { a: { $ref: '#/$defs/s' }, b: { $ref: '#/$defs/s' } }, $defs: { s: { type: 'string', maxLength: 5 } } },
  { type: 'array', items: { $ref: '#/definitions/n' }, definitions: { n: { type: 'integer', minimum: 0, maximum: 9 } } },
  // a reference through a reference, and one into a nested position
  { $ref: '#/$defs/outer', $defs: { outer: { $ref: '#/$defs/inner' }, inner: { type: 'object', properties: { age: { type: 'integer' } }, additionalProperties: false } } },
  { type: 'object', properties: { id: { $ref: '#/$defs/wrap/properties/id' } }, $defs: { wrap: { properties: { id: { type: 'integer', minimum: 5 } } } } },
  // a recursive document: the scanner declines it, and the corpus is here to
  // prove the route past a declined schema still agrees
  { type: 'object', properties: { name: { type: 'string' }, next: { $ref: '#' } }, additionalProperties: false },
  // names a JSON pointer has to unescape
  { type: 'object', properties: { a: { $ref: '#/$defs/a~1b' } }, $defs: { 'a/b': { type: 'string' } } },
];

// The realistic schemas the AOT tests use. These carry a root $id, nested
// $defs and local references, which is the shape the suite does not have.
const fixtureDir = path.join(__dirname, 'fixtures/aot-build');
if (fs.existsSync(fixtureDir)) {
  for (const name of fs.readdirSync(fixtureDir)) {
    if (!name.endsWith('.json')) continue;
    try { GEN_SCHEMAS.push(JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'))); } catch {}
  }
}
const CORRUPT = ['', ' ', '{', '}', '[', ']', '"', ',', ':', '\\', '0', 'x', 'é'];
for (const schema of GEN_SCHEMAS) {
  const v = prepare(schema);
  if (!v) continue;
  for (let n = 0; n < 1500; n++) {
    const text = JSON.stringify(randomValue(0));
    check('gen', text, v);
    // one corruption per document, at a position the generator picks
    const pos = Math.floor(rng() * (text.length + 1));
    const ins = CORRUPT[Math.floor(rng() * CORRUPT.length)];
    check('gen-insert', text.slice(0, pos) + ins + text.slice(pos), v);
    if (text.length > 0) {
      const cut = Math.floor(rng() * text.length);
      check('gen-delete', text.slice(0, cut) + text.slice(cut + 1), v);
    }
    // whitespace injection must never change an answer
    const wpos = Math.floor(rng() * (text.length + 1));
    check('gen-space', text.slice(0, wpos) + ' ' + text.slice(wpos), v);
  }
}

// ---------------------------------------------------------------------------
// 4. the wiring. isValidJSON is what the scanner is actually plugged into, so
// the route through it has to give the same answer as parsing would, bails and
// declines included. This is the end-to-end contract; the corpora above test
// the compiler underneath it.
let wired = 0, wiredCases = 0;
const wiredFailures = [];
// One validator per schema, not per document: constructing one compiles the
// schema, and doing that per comparison made this test the slowest in the run.
function wiredValidator(schema) {
  let v;
  try { v = new Validator(schema); } catch { return null; }
  if (typeof v.isValidJSON !== 'function') return null;
  // A scanner is built only once a caller has asked often enough to earn it,
  // and this test is the caller that has to see it on the first comparison.
  if (typeof v._ensureScanner === 'function') v._ensureScanner(true);
  return v;
}
function checkWired(v, text) {
  if (!v) return;
  let ref;
  try { ref = v.validate(JSON.parse(text)).valid; } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    ref = false;
  }
  let got;
  try { got = v.isValidJSON(text); } catch (e) {
    wiredFailures.push(`isValidJSON threw ${e.message} for ${JSON.stringify(text).slice(0, 100)}`);
    return;
  }
  wiredCases++;
  if (v._scanner) wired++;
  if (got !== ref) {
    wiredFailures.push(`isValidJSON says ${got}, validate says ${ref} for schema ${JSON.stringify(v._schemaObj || {}).slice(0, 90)} text ${JSON.stringify(text).slice(0, 100)}`);
  }
}
for (const schema of GEN_SCHEMAS.concat(PERMISSIVE)) {
  const v = wiredValidator(schema);
  if (!v) continue;
  for (const text of MALFORMED) checkWired(v, text);
  for (let n = 0; n < 200; n++) {
    const text = JSON.stringify(randomValue(0));
    checkWired(v, text);
    const pos = Math.floor(rng() * (text.length + 1));
    checkWired(v, text.slice(0, pos) + CORRUPT[Math.floor(rng() * CORRUPT.length)] + text.slice(pos));
  }
  // a duplicate key is the shape the scanner bails on, and the parser takes
  // the last one; the wired route has to land on the parser's answer
  checkWired(v, '{"a":1,"a":"x"}');
  checkWired(v, '{"id":0,"id":5,"name":"ok"}');
  checkWired(v, '{"\\u0061":1}');
}
if (wiredFailures.length > 0) {
  console.error(`\n${wiredFailures.length} wiring disagreement(s):`);
  for (const f of wiredFailures.slice(0, 40)) console.error('  ' + f);
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log(`isValidJSON wiring: ${wiredCases} comparisons, ${wired} of them through a scanner`);
console.log(`scanner differential: ${cases} comparisons over ${compiled} compiled schemas (${declined} declined), ${bails} bails`);
if (failures.length > 0) {
  console.error(`\n${failures.length} disagreement(s):`);
  for (const f of failures.slice(0, 40)) console.error('  ' + f);
  process.exit(1);
}
if (compiled === 0) { console.error('no schema compiled; the differential proved nothing'); process.exit(1); }
console.log('scanner and validate() agree on every comparison');

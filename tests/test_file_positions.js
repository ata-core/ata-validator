'use strict';

// File positions on errors, delivered through the two channels that did not
// have them: a standalone module built with { positions: true } exports
// validateJSON(text), and the compat shim's attachDataFrames(errors, text)
// puts frames on Ajv-shaped errors after the fact. Both walk the original
// text once and map through instancePath, so an error lands on its own
// occurrence of a key that repeats across sections, which is exactly the
// case a first-occurrence string search gets wrong.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toStandaloneModule } = require('../build.js');
const Compat = require('../compat.js');

let passed = 0;
function ok(name) { console.log('  PASS  ' + name); passed++; }

const SCHEMA = {
  type: 'object',
  properties: {
    server: { type: 'object', properties: { port: { type: 'integer', maximum: 100 } }, required: ['port'] },
    client: { type: 'object', properties: { port: { type: 'integer', minimum: 1000 } } },
  },
  required: ['server'],
};
// `port` appears twice; each error must point at its own section.
const TEXT = '{\n  "server": { "port": 999 },\n  "client": { "port": 5 }\n}';

function load(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-pos-'));
  const p = path.join(dir, 'v.cjs');
  fs.writeFileSync(p, src);
  const mod = require(p);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

// --- the standalone module maps each error to its own occurrence -------------
{
  const src = toStandaloneModule(SCHEMA, { abortEarly: false, format: 'cjs', positions: true });
  assert.ok(!src.includes('require('), 'the emitted module still imports nothing');
  const mod = load(src);
  const r = mod.validateJSON(TEXT);
  assert.strictEqual(r.valid, false);
  const byPath = Object.fromEntries(r.errors.map((e) => [e.instancePath, e.dataFrame]));
  assert.deepStrictEqual(
    { line: byPath['/server/port'].line, col: byPath['/server/port'].col },
    { line: 2, col: 23 },
  );
  assert.deepStrictEqual(
    { line: byPath['/client/port'].line, col: byPath['/client/port'].col },
    { line: 3, col: 23 },
  );
  for (const e of r.errors) {
    for (const k of ['byteOffset', 'length', 'line', 'col', 'text']) assert.ok(k in e.dataFrame, k);
  }
  assert.strictEqual(mod.validateJSON('{"server":{"port":5}}').valid, true);
  ok('validateJSON frames each error on its own occurrence of a repeated key');
}

// --- a syntax error is one ATA9001 with a frame on the document ---------------
{
  const mod = load(toStandaloneModule(SCHEMA, { abortEarly: false, format: 'cjs', positions: true }));
  const r = mod.validateJSON('{"server": }');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].code, 'ATA9001');
  assert.strictEqual(r.errors[0].keyword, '__parse__');
  assert.strictEqual(r.errors[0].dataFrame.line, 1);
  ok('a syntax error reports ATA9001 with a document frame');
}

// --- abort-early modules: the shared frozen error is copied, never mutated ----
{
  const mod = load(toStandaloneModule(SCHEMA, { abortEarly: true, format: 'cjs', positions: true }));
  const r1 = mod.validateJSON(TEXT);
  assert.strictEqual(r1.valid, false);
  const plain = mod.validate(JSON.parse(TEXT));
  assert.ok(!('dataFrame' in plain.errors[0]), 'the shared ABORT error object stays pristine');
  ok('positions on an abortEarly module copy the frozen error');
}

// --- off by default, and the esm export line carries it when on ---------------
{
  const plain = toStandaloneModule(SCHEMA, { abortEarly: false, format: 'cjs' });
  assert.ok(!plain.includes('validateJSON'), 'no positions option, no validateJSON');
  const esm = toStandaloneModule(SCHEMA, { abortEarly: false, format: 'esm', positions: true });
  assert.ok(/export \{[^}]*validateJSON/.test(esm), 'esm modules export it too');
  ok('validateJSON is opt-in and present in both formats');
}

// --- compat: attachDataFrames replaces a hand-written line finder -------------
{
  const ajv = new Compat({ allErrors: true });
  const validate = ajv.compile(SCHEMA);
  validate(JSON.parse(TEXT));
  const out = Compat.attachDataFrames(validate.errors, TEXT);
  assert.strictEqual(out, validate.errors, 'mutates and returns the same array');
  const byPath = Object.fromEntries(out.map((e) => [e.instancePath, e.dataFrame]));
  assert.strictEqual(byPath['/server/port'].line, 2);
  assert.strictEqual(byPath['/client/port'].line, 3);
  ok('compat frames land on the right occurrence of a repeated key');
}

// --- compat edge cases --------------------------------------------------------
{
  assert.strictEqual(Compat.attachDataFrames(null, TEXT), null);
  assert.deepStrictEqual(Compat.attachDataFrames([], TEXT), []);
  const kept = { instancePath: '/server/port', dataFrame: { line: 42 } };
  Compat.attachDataFrames([kept], TEXT);
  assert.strictEqual(kept.dataFrame.line, 42, 'an existing frame is not overwritten');
  const missing = { instancePath: '/nowhere' };
  Compat.attachDataFrames([missing], TEXT);
  assert.ok(!('dataFrame' in missing), 'a pointer with no position gets no frame');
  const buf = { instancePath: '/server/port' };
  Compat.attachDataFrames([buf], Buffer.from(TEXT));
  assert.strictEqual(buf.dataFrame.line, 2, 'Buffer input works');
  ok('compat edge cases: null, existing frame, unknown pointer, Buffer');
}

console.log(`\n${passed} passed, 0 failed`);

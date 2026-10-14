'use strict';

// A definition on a reference cycle becomes a function in the preamble, above
// the entry function, so a `$ref: "#"` inside it cannot name the entry. It
// goes through a forwarder the entry fills in. Before, such a schema declined
// code generation altogether: SchemaStore's jsone ran on the interpreter.
// Generated code, the interpreter, a standalone module and a bundle of two
// such schemas (each with its own forwarder) must all give one answer.

const assert = require('assert');
const { Validator } = require('..');
const aot = require('../lib/aot');

function load (code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports; }

// Shaped like jsone: the root is an object, a definition is anyOf of the root
// and of arrays of itself.
const make = (leaf) => ({
  $defs: {
    value: { anyOf: [{ $ref: '#' }, { type: 'array', items: { $ref: '#/$defs/value' } }, { type: leaf }] },
  },
  type: 'object',
  properties: { a: { $ref: '#/$defs/value' }, n: { type: 'integer' } },
  additionalProperties: { $ref: '#/$defs/value' },
});
const one = make('string');
const two = make('number');

const docs = [
  {}, { a: 'x' }, { a: 1 }, { a: [['x', { n: 2 }]] }, { a: [['x', { n: 'no' }]] },
  { b: { c: { d: 'x' } } }, { b: { c: { d: 3 } } }, { a: [{ a: [{ a: 'deep' }] }] }, { a: [{ a: [{ n: 1.5 }] }] },
];

let codegen = true;
try { new Function('return 1'); } catch { codegen = false; }

let checked = 0;
for (const schema of [one, two]) {
  const v = new Validator(schema);
  const vi = new Validator(schema, { engine: 'interpreter' });
  if (codegen) assert.strictEqual(v.engine(), 'codegen', 'a definition that refers to the root compiles');
  for (const d of docs) {
    const want = vi.validate(d).valid;
    assert.strictEqual(v.validate(d).valid, want, JSON.stringify(d));
    assert.strictEqual(v.isValidObject(d), want, JSON.stringify(d));
    checked++;
  }
  if (codegen) {
    const mod = load(aot.toStandaloneModule(new Validator(schema), { format: 'cjs', onWarning () {} }));
    for (const d of docs) { assert.strictEqual(mod.validate(d).valid, vi.validate(d).valid, 'standalone ' + JSON.stringify(d)); checked++; }
  }
}
if (codegen) {
  // Two schemas in one bundle: each forwarder must reach its own root.
  const [b1, b2] = load(Validator.bundleStandalone([one, two], { format: 'cjs' }));
  const i1 = new Validator(one, { engine: 'interpreter' });
  const i2 = new Validator(two, { engine: 'interpreter' });
  for (const d of docs) {
    assert.strictEqual(b1(d).valid, i1.validate(d).valid, 'bundle, first schema ' + JSON.stringify(d));
    assert.strictEqual(b2(d).valid, i2.validate(d).valid, 'bundle, second schema ' + JSON.stringify(d));
    checked += 2;
  }
}
console.log(`ok: definitions that refer to the root compile and agree everywhere (${checked} answers)`);

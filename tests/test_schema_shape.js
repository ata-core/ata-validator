'use strict';

// `enum` and `required` must be arrays (JSON Schema Validation 6.1.2 and
// 6.5.3). Given anything else, each engine failed its own way: the code
// generator threw "vals.filter is not a function" or "schema.required.map is
// not a function", the interpreter "Cannot read properties of null", and the
// interpreter skipped a non-array `required` and accepted every object. Every
// entry point now throws the same schema error. null reads as absent, as it
// always has, and a property named `enum` or `required` is a name.

const assert = require('assert');
const { Validator } = require('..');
const aot = require('../lib/aot-build');

const BAD = [
  [{ enum: 'abc' }, 'zzz', 'enum'],
  [{ enum: { a: 1 } }, 'zzz', 'enum'],
  [{ enum: 5 }, 5, 'enum'],
  [{ properties: { x: { enum: 'abc' } } }, { x: 'zzz' }, 'enum'],
  [{ items: { enum: 'abc' } }, ['zzz'], 'enum'],
  [{ required: 'a' }, {}, 'required'],
  [{ required: true }, {}, 'required'],
  [{ properties: { a: { required: true } } }, { a: {} }, 'required'],
  [{ allOf: [{}, { required: 'q' }] }, {}, 'required'],
];

let checks = 0;
for (const [schema, data, k] of BAD) {
  const msg = `invalid schema: "${k}" must be an array`;
  const label = JSON.stringify(schema);
  for (const opts of [{}, { engine: 'interpreter' }]) {
    for (const [name, call] of [
      ['validate', (v) => v.validate(structuredClone(data))],
      ['isValidObject', (v) => v.isValidObject(structuredClone(data))],
      ['isValid(Buffer)', (v) => v.isValid(Buffer.from(JSON.stringify(data)))],
    ]) {
      assert.throws(() => call(new Validator(schema, opts)), { name: 'TypeError', message: msg }, `${name} ${JSON.stringify(opts)} ${label}`);
      checks++;
    }
  }
  for (const [name, call] of [
    ['toStandaloneModule', () => aot.toStandaloneModule(schema)],
    ['bundleStandalone', () => aot.bundleStandalone([schema])],
    ['bundleCompact', () => aot.bundleCompact([schema])],
  ]) {
    assert.throws(call, { name: 'TypeError', message: msg }, `${name} ${label}`);
    checks++;
  }
}

// Unchanged: null is absent, an empty enum rejects everything, and a property
// called enum or required is a property.
const SAME = [
  [{ enum: null }, 'x', true],
  [{ required: null }, {}, true],
  [{ enum: [] }, 'x', false],
  [{ properties: { enum: { type: 'string' }, required: { type: 'object' } }, required: ['enum'] }, { enum: 'a', required: {} }, true],
  [{ properties: { enum: { type: 'string' } }, required: ['enum'] }, {}, false],
  [{ enum: [{ required: 'x' }] }, { required: 'x' }, true],
];
for (const [schema, data, valid] of SAME) {
  for (const opts of [{}, { engine: 'interpreter' }]) {
    const v = new Validator(schema, opts);
    assert.strictEqual(v.validate(structuredClone(data)).valid, valid, `${JSON.stringify(opts)} ${JSON.stringify(schema)}`);
    assert.strictEqual(v.isValidObject(structuredClone(data)), valid);
    checks += 2;
  }
}

// ata-validator/ir: the front end throws the same error; the module builders
// decline such a schema (null), so the caller falls back to the Validator.
(async () => {
  const ir = await import('../lib/ir/index.mjs');
  for (const [schema, , k] of BAD) {
    const msg = `invalid schema: "${k}" must be an array`;
    for (const name of ['front', 'compileClosures', 'specialize']) {
      assert.throws(() => ir[name](schema), { name: 'TypeError', message: msg }, `ir.${name} ${JSON.stringify(schema)}`);
      checks++;
    }
    for (const name of ['tableModule', 'closureModule']) {
      assert.strictEqual(ir[name](schema), null, `ir.${name} declines ${JSON.stringify(schema)}`);
      checks++;
    }
  }
  console.log(`ok: a non-array enum or required is one schema error on every entry point (${checks} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });

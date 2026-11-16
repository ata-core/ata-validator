'use strict';

// A `$dynamicRef` whose anchor exists nowhere in the schema. The three code
// generators each wrote no check for it and answered every value as valid,
// so `{ properties: { a: { $dynamicRef: '#nope' } } }` accepted `{ a: 1 }`
// where the interpreted engine rejects it. They now decline, and the answer
// comes from the interpreted engine on every method.

const assert = require('assert');
const { Validator } = require('..');
const jc = require('../lib/js-compiler');
const aot = require('../lib/aot-build');

const R = { valid: true, errors: [] };
const CASES = [
  [{ properties: { a: { $dynamicRef: '#nope' } } }, { a: 1 }],
  [{ items: { $dynamicRef: '#nope' } }, [1]],
  [{ allOf: [{ $dynamicRef: '#nope' }] }, 1],
  [{ $dynamicRef: '#nope' }, 1],
  [{ $defs: { x: { $dynamicAnchor: 'other' } }, properties: { a: { $dynamicRef: '#nope' } } }, { a: 1 }],
  // An optional property with two leaf checks beside the reference took a
  // shortcut that wrote the leaf checks and skipped the reference.
  [{ type: 'object', properties: { a: { $dynamicRef: '#nope', type: 'integer', minimum: 0 } } }, { a: 1 }],
];

let checks = 0;
for (const [schema, data] of CASES) {
  const label = JSON.stringify(schema);
  assert.strictEqual(jc.compileToJSCodegen(schema, null, null), null, `compileToJSCodegen declines ${label}`);
  assert.strictEqual(jc.compileToJSCombined(schema, R, null, null), null, `compileToJSCombined declines ${label}`);
  assert.strictEqual(jc.compileToJSCodegenWithErrors(schema, null, null), null, `compileToJSCodegenWithErrors declines ${label}`);
  assert.strictEqual(aot.toStandaloneModule(schema), null, `toStandaloneModule declines ${label}`);
  checks += 4;
  const ref = new Validator(schema, { engine: 'interpreter' }).validate(structuredClone(data)).valid;
  assert.strictEqual(ref, false, `the interpreted engine rejects ${label}`);
  const text = JSON.stringify(data);
  for (const [name, call] of [
    ['validate', (v) => v.validate(structuredClone(data)).valid],
    ['isValidObject', (v) => v.isValidObject(structuredClone(data))],
    ['validateJSON', (v) => v.validateJSON(text).valid],
    ['isValidJSON', (v) => v.isValidJSON(text)],
  ]) {
    assert.strictEqual(call(new Validator(schema)), false, `${name} ${label}`);
    checks++;
  }
}

// Beside other keywords, under every applicator, on every method: the
// answer is the interpreted engine's.
const LEAVES = [{}, { type: 'integer', minimum: 0 }, { type: 'integer', minimum: 0, maximum: 9 }, { type: 'string', minLength: 1, maxLength: 5 }, { enum: [1, 2] }, { type: 'object', required: ['x'] }];
const WRAPS = [
  (l) => ({ type: 'object', properties: { a: l } }), (l) => ({ type: 'object', properties: { a: l }, required: ['a'] }),
  (l) => ({ type: 'array', items: l }), (l) => ({ prefixItems: [l] }), (l) => ({ additionalProperties: l }),
  (l) => ({ anyOf: [l, { type: 'null' }] }), (l) => ({ not: l }), (l) => ({ properties: { a: { properties: { b: l } } } }),
  (l) => ({ $defs: { d: l }, properties: { a: { $ref: '#/$defs/d' } } }),
];
for (const w of WRAPS) for (const leaf of LEAVES) {
  const schema = w({ ...leaf, $dynamicRef: '#nope' });
  for (const d of [1, { a: 1 }, { a: { b: 1 } }, [1]]) {
    const want = new Validator(schema, { engine: 'interpreter' }).validate(structuredClone(d)).valid;
    const text = JSON.stringify(d);
    const got = [new Validator(schema).validate(structuredClone(d)).valid, new Validator(schema).isValidObject(structuredClone(d)), new Validator(schema).isValidJSON(text)];
    assert.deepStrictEqual(got, [want, want, want], `${JSON.stringify(schema)} on ${text}`);
    checks++;
  }
}

// A resolvable one still compiles.
const ok = { $dynamicAnchor: 'n', properties: { a: { $dynamicRef: '#n' } }, type: 'object' };
assert.notStrictEqual(jc.compileToJSCodegen(ok, null, null), null, 'a resolvable $dynamicRef compiles');
assert.strictEqual(new Validator(ok).validate({ a: { a: {} } }).valid, true);
assert.strictEqual(new Validator(ok).validate({ a: 1 }).valid, false);

console.log(`ok: a $dynamicRef with no anchor is rejected on every path (${checks} checks)`);

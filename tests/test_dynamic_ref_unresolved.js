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

// A resolvable one still compiles.
const ok = { $dynamicAnchor: 'n', properties: { a: { $dynamicRef: '#n' } }, type: 'object' };
assert.notStrictEqual(jc.compileToJSCodegen(ok, null, null), null, 'a resolvable $dynamicRef compiles');
assert.strictEqual(new Validator(ok).validate({ a: { a: {} } }).valid, true);
assert.strictEqual(new Validator(ok).validate({ a: 1 }).valid, false);

console.log(`ok: a $dynamicRef with no anchor is rejected on every path (${checks} checks)`);

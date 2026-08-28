'use strict';

// Each shape the code generator learns to take gets one entry here. The
// interpreter is the correctness authority: codegen must route the shape,
// agree with the interpreter on every verdict, and agree on the errors it
// reports, keyword and path. A shape that codegen still declines fails
// loudly instead of passing by accident.
const assert = require('node:assert');
const { Validator } = require('..');
const { compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined } = require('../lib/js-compiler');
const { createInterpreter } = require('../lib/interpreter');
const { isDraft7, normalizeDraft7 } = require('../lib/draft7');

const VALID = { valid: true, errors: [] };

function errorKeys (errors) {
  return (errors || []).map((e) => `${e.keyword}@${e.instancePath}`).sort();
}

function checkShape (name, schema, cases) {
  // The Validator normalizes draft-7 spellings (tuple items, additionalItems)
  // before any engine sees the schema; the generators and the interpreter are
  // called directly here, so do the same on a copy.
  if (isDraft7(schema)) schema = normalizeDraft7(JSON.parse(JSON.stringify(schema)));
  const bool = compileToJSCodegen(schema, null, undefined);
  assert.ok(typeof bool === 'function', `${name}: compileToJSCodegen must take this shape`);
  const errFn = compileToJSCodegenWithErrors(schema, null, undefined);
  assert.ok(typeof errFn === 'function', `${name}: compileToJSCodegenWithErrors must take this shape`);
  // The combined generator has its own, narrower gate and the router falls
  // back to the errors generator when it declines, so it may return null
  // here; when it does compile it must agree like the others.
  const comb = compileToJSCombined(schema, VALID, null, undefined);
  const hybrid = bool._hybridFactory ? bool._hybridFactory(VALID, (d) => errFn(d, true)) : null;
  const interp = createInterpreter(schema, { schemaMap: null, formats: undefined, v1: false });

  for (const [data, expected] of cases) {
    const ref = interp.validate(data);
    assert.strictEqual(ref.valid, expected, `${name}: the case table disagrees with the interpreter on ${JSON.stringify(data)}`);
    assert.strictEqual(bool(data), expected, `${name}: boolean verdict on ${JSON.stringify(data)}`);
    assert.strictEqual(errFn(data, true).valid, expected, `${name}: errors verdict on ${JSON.stringify(data)}`);
    if (comb) assert.strictEqual(comb(data).valid, expected, `${name}: combined verdict on ${JSON.stringify(data)}`);
    if (hybrid) assert.strictEqual(hybrid(data).valid, expected, `${name}: hybrid verdict on ${JSON.stringify(data)}`);
    if (!expected) {
      assert.deepStrictEqual(errorKeys(errFn(data, true).errors), errorKeys(ref.errors), `${name}: error keywords and paths on ${JSON.stringify(data)}`);
      if (comb) assert.deepStrictEqual(errorKeys(comb(data).errors), errorKeys(ref.errors), `${name}: combined error keywords and paths on ${JSON.stringify(data)}`);
    }
  }

  const v = new Validator(schema);
  v.validate(cases[0][0]);
  assert.strictEqual(v.engine(), 'codegen', `${name}: the router must pick codegen`);
  console.log(`ok: ${name}`);
}

// Proof the harness works: a shape codegen has always taken. On 'x' both
// branches match, so it is invalid; on 1 only the `true` branch does.
checkShape('oneOf with boolean members', { oneOf: [true, { type: 'string' }] }, [
  ['x', false],
  [1, true],
]);

// items: false rejects any element past the prefix; items: true constrains nothing.
checkShape('items: false with prefixItems', { type: 'array', prefixItems: [{ type: 'string' }], items: false }, [
  [['a'], true],
  [['a', 1], false],
  [[], true],
  [[1], false],
]);
checkShape('items: false alone', { items: false }, [
  [[], true],
  [[1], false],
  ['not an array', true],
]);
checkShape('items: true with a length bound', { type: 'array', items: true, maxItems: 2 }, [
  [[1, 'x'], true],
  [[1, 2, 3], false],
]);
// Draft 7 spells the same thing with additionalItems; lib/draft7.js maps it.
checkShape('draft-7 additionalItems: false', { $schema: 'http://json-schema.org/draft-07/schema#', items: [{ type: 'string' }], additionalItems: false }, [
  [['a'], true],
  [['a', 'b'], false],
]);

checkShape('properties with a false member', { type: 'object', properties: { x: false, y: true, z: { type: 'number' } } }, [
  [{}, true],
  [{ y: 1 }, true],
  [{ x: 1 }, false],
  [{ z: 'no' }, false],
]);
checkShape('properties false without type', { properties: { x: false } }, [
  [{ x: null }, false],
  [{ y: 1 }, true],
  ['not an object', true],
]);

module.exports = { checkShape };

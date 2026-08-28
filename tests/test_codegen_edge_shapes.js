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

const VALID = { valid: true, errors: [] };

function errorKeys (errors) {
  return (errors || []).map((e) => `${e.keyword}@${e.instancePath}`).sort();
}

function checkShape (name, schema, cases) {
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

module.exports = { checkShape };

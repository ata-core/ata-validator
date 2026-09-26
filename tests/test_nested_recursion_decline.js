'use strict';

// Two faults found by inventorying the three code generators side by side,
// both present since at least 1.29.0 and both reachable from the public API.
//
// 1. The combined generator emitted nothing for a $dynamicRef back to the
//    root, and a function with nothing in it answers valid. validateJSON
//    takes the hybrid, whose error slot is the combined function, so a
//    document the verdict rejected came back { valid: true }. validate() and
//    isValidObject() were right only because their outer layer takes the
//    verdict from the boolean function.
//
// 2. The error and combined generators compile not/if/contains subschemas
//    with the boolean generator, which reaches the root through `_validate`
//    and a reference cycle through a named preamble function. Neither exists
//    in their functions: `not: { $ref: '#' }` threw a ReferenceError from
//    `.errors` and from validateJSON, and a cycle was cut so the reference
//    checked nothing.
//
// The generators now decline those shapes, and an error resolver that says
// valid after the verdict said no is turned into a rejection rather than
// returned.

const assert = require('assert');
const { Validator } = require('..');
const jc = require('../lib/js-compiler');

const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) });
const clone = (x) => JSON.parse(JSON.stringify(x));

const cases = [
  ['$dynamicRef to the root', { $dynamicAnchor: 'node', type: 'object', properties: { child: { $dynamicRef: '#node' } } }, [{ child: 5 }, { child: { child: 'x' } }], [{ child: {} }, {}]],
  ['not: {$ref: "#"}', { type: 'object', properties: { a: { not: { $ref: '#' } } } }, [{ a: {} }], [{ a: 1 }, {}]],
  ['if: {$ref: "#"}', { type: 'object', properties: { a: { if: { $ref: '#' }, then: { required: ['z'] } } } }, [{ a: {} }], [{ a: 1 }, { a: { z: 1 } }]],
  ['contains a cycle', { $defs: { n: { type: 'object', properties: { c: { $ref: '#/$defs/n' } } } }, type: 'array', contains: { $ref: '#/$defs/n' } }, [[1, 2]], [[{ c: { c: {} } }]]],
  ['not a cycle', { $defs: { n: { type: 'object', properties: { c: { $ref: '#/$defs/n' } } } }, properties: { a: { not: { $ref: '#/$defs/n' } } } }, [{ a: {} }], [{ a: 1 }, { a: { c: { c: 1 } } }]],
];

for (const [label, schema, invalid, valid] of cases) {
  const interp = new Validator(clone(schema), { engine: 'interpreter' });
  for (const [data, want] of [...invalid.map((d) => [d, false]), ...valid.map((d) => [d, true])]) {
    assert.strictEqual(interp.validate(clone(data)).valid, want, `${label}: the interpreted engine is the reference, ${JSON.stringify(data)}`);
    const v = new Validator(clone(schema));
    const text = JSON.stringify(data);
    let r;
    assert.doesNotThrow(() => { r = v.validate(clone(data)); r.errors; }, `${label}: validate().errors threw on ${text}`);
    assert.strictEqual(r.valid, want, `${label}: validate on ${text}`);
    assert.strictEqual(new Validator(clone(schema)).isValidObject(clone(data)), want, `${label}: isValidObject on ${text}`);
    let j;
    assert.doesNotThrow(() => { j = new Validator(clone(schema)).validateJSON(text); j.errors; }, `${label}: validateJSON threw on ${text}`);
    assert.strictEqual(j.valid, want, `${label}: validateJSON on ${text}`);
    // Twice more on one instance, so the paths that swap in after the first
    // rejection answer too.
    const w = new Validator(clone(schema));
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(w.validateJSON(text).valid, want, `${label}: validateJSON call ${i} on ${text}`);
      assert.strictEqual(w.validate(clone(data)).valid, want, `${label}: validate call ${i} on ${text}`);
    }
  }
}

// The generators themselves: the combined one declines the root reference
// instead of emitting an empty function, and neither error-collecting
// generator hands back a function that throws.
{
  const root = { $dynamicAnchor: 'node', type: 'object', properties: { child: { $dynamicRef: '#node' } } };
  assert.strictEqual(jc.compileToJSCombined(root, VALID, null, undefined), null, 'combined declines a $dynamicRef to the root');
  for (const [label, schema, , ] of cases) {
    for (const [name, fn] of [['combined', jc.compileToJSCombined(clone(schema), VALID, null, undefined)], ['errors', jc.compileToJSCodegenWithErrors(clone(schema), null, undefined)]]) {
      if (fn === null) continue;
      for (const data of [{}, { a: {} }, { a: { c: { c: 1 } } }, [{ c: {} }], { child: { child: 1 } }]) {
        assert.doesNotThrow(() => (name === 'errors' ? fn(data, true) : fn(data)), `${label}: the ${name} function threw on ${JSON.stringify(data)}`);
      }
    }
  }
}

// A pattern compiled by the boolean generator inside the combined one needs
// the safe-regex factory bound; deep enough that the router's probes do not
// reach it.
{
  const schema = { type: 'object', properties: { o: { type: 'object', properties: { a: { not: { type: 'string', pattern: '^x' } } } } } };
  const fn = jc.compileToJSCombined(schema, VALID, null, undefined);
  assert.ok(fn, 'combined compiles a pattern under not');
  assert.doesNotThrow(() => fn({ o: { a: 'xy' } }), 'the combined function binds __ataSafeRe');
  assert.strictEqual(fn({ o: { a: 'xy' } }).valid, false);
  assert.strictEqual(fn({ o: { a: 'yy' } }).valid, true);
}

console.log(`ok: nested recursion declines, ${cases.length} shapes through every entry point`);

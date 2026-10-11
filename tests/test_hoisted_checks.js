'use strict';

// The generated code writes `not`, `if`, `then` and `else` as functions in its
// preamble, passing whether the value is an ordinary object, and takes a
// definition that refers to itself on the same value through allOf or anyOf
// as true at that reference (lib/js-compiler.js, hoistedCheck and
// breakSelfLoops). Every shape here must answer as the interpreted engine
// does, verdicts and error lists, read more than once, and never throw: the
// first version passed a flag into code the combined generator nests in a
// function of its own, where it was not defined (SchemaStore's github-action).

const assert = require('assert');
const { Validator } = require('..');

const cases = [
  // The shape that threw a ReferenceError on reading errors.
  [{ definitions: { rc: { properties: { steps: { items: { oneOf: [{ anyOf: [{ not: {} }] }] } } } } }, properties: { runs: { oneOf: [{ $ref: '#/definitions/rc' }] } } },
    [{ runs: { steps: [1] } }, { runs: { steps: [] } }, { runs: 1 }, {}]],
  // if/then dispatch on a tag, several branches, the tag absent or not a string.
  [{ type: 'object', properties: { t: { type: 'string' } }, allOf: [
    { if: { properties: { t: { const: 'a' } } }, then: { required: ['x'] } },
    { if: { properties: { t: { const: 'b' } } }, then: { properties: { y: { type: 'number' } } }, else: { not: { required: ['z'] } } },
  ] }, [{ t: 'a' }, { t: 'a', x: 1 }, { t: 'b', y: 'n' }, { t: 'c', z: 1 }, { z: 1 }, {}, { t: 1 }]],
  // not of an object check, on objects with another prototype too.
  [{ not: { properties: { k: { const: 1 } }, required: ['k'] } }, [{ k: 1 }, { k: 2 }, Object.create({ k: 1 }), 5]],
  // A definition that refers to itself through allOf and anyOf on the same value.
  [{ $ref: '#/definitions/X', definitions: { X: { type: 'object', required: ['a'], allOf: [{ $ref: '#/definitions/X' }, { anyOf: [{ $ref: '#/definitions/X' }, { required: ['b'] }] }], properties: { a: { type: 'string' }, c: { $ref: '#/definitions/X' } } } } },
    [{ a: 's' }, { a: 1 }, {}, { a: 's', c: { a: 's' } }, { a: 's', c: {} }, 'x']],
  // Through oneOf the self-reference is left as it is, and the schema answers
  // as before, whichever engine takes it.
  [{ $ref: '#/definitions/Y', definitions: { Y: { oneOf: [{ $ref: '#/definitions/Y' }, { type: 'string' }] } } }, ['s', 1, null]],
];

let compared = 0;
for (const [schema, docs] of cases) {
  for (const rich of [true, false]) {
    const a = new Validator(schema, { richErrors: rich });
    a._coldCalls = 64;
    const b = new Validator(schema, { richErrors: rich, engine: 'interpreter' });
    for (const d of docs) {
      let ja;
      for (let i = 0; i < 3; i++) ja = JSON.stringify(a.validate(d));
      assert.strictEqual(ja, JSON.stringify(b.validate(d)), `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
      assert.strictEqual(a.isValidObject(d), b.isValidObject(d));
      compared++;
    }
  }
}
console.log(`ok: ${compared} documents answer alike with the checks written in the preamble`);

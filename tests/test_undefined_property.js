'use strict';

// A declared property whose value is undefined. No JSON document carries one,
// but a JavaScript object handed to validate() can, and a response a server is
// about to serialize often does (`{ id: req.params.id }` with no such param).
// Every engine reads it as the default validator does, and as it would be
// once serialized: absent. Its value is not checked, and a required key
// holding it is missing. The engines must give one answer.

const assert = require('assert');
const { Validator } = require('..');

const cases = [
  [{ type: 'object', properties: { a: { type: 'number' } } }, { a: undefined }, true],
  [{ type: 'object', properties: { a: { type: 'number' } }, required: ['b'] }, { a: undefined, b: 1 }, true],
  [{ type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false }, { a: undefined }, true],
  [{ type: 'object', properties: { n: { type: 'object', properties: { b: { type: 'string' } } } } }, { n: { b: undefined } }, true],
  // Required, untyped and nested shapes, and subschemas the value is checked
  // against in place (if, not), where the generated code once read the key
  // as present and checked the undefined value.
  [{ type: 'object', required: ['a'], properties: { a: { type: 'number' } } }, { a: undefined }, false],
  [{ properties: { a: { type: 'number' } } }, { a: undefined }, true],
  [{ type: 'object', properties: { p: { properties: { a: { type: 'number' } } } } }, { p: { a: undefined } }, true],
  [{ type: 'object', required: ['a'], properties: { a: { type: 'object', properties: { b: { type: 'number' } } } } }, { a: undefined }, false],
  [{ type: 'object', required: ['a'], properties: { a: {} } }, { a: undefined }, false],
  [{ type: 'object', required: ['a'] }, { a: undefined }, false],
  [{ if: { properties: { t: { const: 'x' } } }, then: false }, { t: undefined }, false],
  [{ not: { properties: { t: { const: 'x' } } } }, { t: undefined }, false],
  [{ allOf: [{ if: { properties: { t: { const: 'x' } } }, then: false }] }, { t: undefined }, false],
  [{ type: 'object', properties: { a: { const: 1 } }, additionalProperties: false }, { a: undefined, b: 1 }, false],
  // An absent required key fails, typed or not, in every engine: the
  // generated code finds a typed one absent through its value check.
  [{ type: 'object', required: ['a'], properties: { a: { type: 'number' } } }, {}, false],
  [{ type: 'object', required: ['a', 'b'], properties: { a: { type: 'number' }, b: { type: 'string' } } }, { a: undefined }, false],
  [{ type: 'object', required: ['a'], properties: { a: { enum: [1, 2] } } }, { b: 1 }, false],
  [{ type: 'object', required: ['a'], properties: { a: {} } }, {}, false],
  // Only declared properties: a value matched by patternProperties or
  // additionalProperties is still checked, by every engine.
  [{ type: 'object', additionalProperties: { type: 'number' } }, { a: undefined }, false],
  [{ type: 'object', patternProperties: { '^a': { type: 'number' } } }, { a: undefined }, false],
  [{ type: 'array', items: { type: 'number' } }, [undefined], false],
];

for (const [schema, doc, expected] of cases) {
  for (const opts of [{}, { engine: 'interpreter' }]) {
    const v = new Validator(schema, opts);
    // Enough calls for the interpreter to move to its compiled closures.
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(v.isValidObject(doc), expected, `${JSON.stringify(schema)} ${JSON.stringify(opts)} isValidObject call ${i}`);
      const r = v.validate(doc);
      assert.strictEqual(r.valid, expected, `${JSON.stringify(schema)} ${JSON.stringify(opts)} validate call ${i}`);
      if (!expected && i === 0) assert.ok(r.errors.length > 0, `${JSON.stringify(schema)} ${JSON.stringify(opts)} reports why`);
      assert.strictEqual(v.validateJSON(JSON.stringify(doc)).valid, JSON.parse(JSON.stringify(doc)) !== undefined ? new Validator(schema, opts).validate(JSON.parse(JSON.stringify(doc))).valid : r.valid);
    }
  }
}
console.log(`ok: ${cases.length} schemas give one answer for an undefined property value on both engines`);

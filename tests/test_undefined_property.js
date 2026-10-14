'use strict';

// A declared property whose value is undefined. No JSON document carries one,
// but a JavaScript object handed to validate() can, and a response a server is
// about to serialize often does (`{ id: req.params.id }` with no such param).
// The generated code skips the check, as the default validator does; the
// interpreted engine and its compiled closures checked the value and rejected
// it. The engines must give one answer.

const assert = require('assert');
const { Validator } = require('..');

const cases = [
  [{ type: 'object', properties: { a: { type: 'number' } } }, { a: undefined }, true],
  [{ type: 'object', properties: { a: { type: 'number' } }, required: ['b'] }, { a: undefined, b: 1 }, true],
  [{ type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false }, { a: undefined }, true],
  [{ type: 'object', properties: { n: { type: 'object', properties: { b: { type: 'string' } } } } }, { n: { b: undefined } }, true],
  // A required property is still checked: the generated code checks it
  // unguarded, so `type` rejects undefined there, and a property without a
  // type accepts it as present (#61).
  [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { a: undefined }, false],
  [{ type: 'object', properties: { a: { type: 'string' } }, patternProperties: { '^z': {} }, required: ['a'] }, { a: undefined }, false],
  [{ type: 'object', properties: { a: {} }, required: ['a'] }, { a: undefined }, true],
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
      assert.strictEqual(v.validate(doc).valid, expected, `${JSON.stringify(schema)} ${JSON.stringify(opts)} validate call ${i}`);
    }
  }
}
// The reason matches too: a typed required property set to undefined is
// reported as missing, as the generated code reports it.
{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
  for (const opts of [{}, { engine: 'interpreter' }]) {
    const v = new Validator(schema, opts);
    for (let i = 0; i < 200; i++) {
      const errors = v.validate({ a: undefined }).errors;
      assert.deepStrictEqual(errors.map((e) => [e.keyword, e.params.missingProperty]), [['required', 'a']], `${JSON.stringify(opts)} validate call ${i}`);
    }
  }
}

console.log(`ok: ${cases.length} schemas give one answer for an undefined property value on both engines`);

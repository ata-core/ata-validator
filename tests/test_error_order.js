'use strict';

// Errors follow the schema's keyword declaration order, matching what AJV
// users expect: a schema declaring properties before required reports the
// property errors first, and vice versa. Order within one keyword is
// preserved (required errors follow the required array).

const assert = require('node:assert');
const { Validator } = require('../index.js');

function keywords(result) {
  return result.errors.map((e) => e.keyword + (e.instancePath || ''));
}

// properties declared before required: property error first (the Fastify
// ajv-errors scenario)
{
  const v = new Validator({
    type: 'object',
    properties: { age: { type: 'number' } },
    required: ['name', 'work'],
  });
  const r = v.validate({ hello: 'x', age: 'bad' });
  assert.deepStrictEqual(keywords(r), ['type/age', 'required', 'required'], 'properties-first schema');
  assert.strictEqual(r.errors[1].params.missingProperty, 'name');
  assert.strictEqual(r.errors[2].params.missingProperty, 'work');
}

// required declared before properties: required errors first
{
  const v = new Validator({
    type: 'object',
    required: ['name', 'work'],
    properties: { age: { type: 'number' } },
  });
  const r = v.validate({ hello: 'x', age: 'bad' });
  assert.deepStrictEqual(keywords(r), ['required', 'required', 'type/age'], 'required-first schema');
}

// deeper nesting: sibling property errors follow properties declaration order
{
  const v = new Validator({
    type: 'object',
    properties: {
      b: { type: 'string' },
      a: { type: 'number' },
    },
  });
  const r = v.validate({ a: 'x', b: 1 });
  assert.deepStrictEqual(keywords(r), ['type/b', 'type/a'], 'sibling property order');
}

// abortEarly single-error fast path is untouched
{
  const v = new Validator(
    { type: 'object', properties: { age: { type: 'number' } }, required: ['name'] },
    { abortEarly: true }
  );
  const r = v.validate({ age: 'bad' });
  assert.strictEqual(r.valid, false);
}

console.log('ok: error ordering follows schema declaration order');

'use strict';

// Constructing a Validator does not walk the schema. Normalization (draft-07
// rewrites, nullable, assertFormat: false) and the scan that decides whether
// it is needed happen on first use, where compilation happens anyway. A
// server building one validator per request, or a benchmark timing
// construction, pays for the object and nothing else.

const assert = require('node:assert');
const { Validator } = require('../index');

// A schema whose every property read is counted.
function counted(schema, counter) {
  if (typeof schema !== 'object' || schema === null) return schema;
  if (Array.isArray(schema)) return schema.map((s) => counted(s, counter));
  const out = {};
  for (const key of Object.keys(schema)) {
    const value = counted(schema[key], counter);
    Object.defineProperty(out, key, {
      enumerable: true,
      configurable: true,
      get() { counter.reads++; return value; },
    });
  }
  return out;
}

const shape = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  definitions: { pos: { type: 'integer', minimum: 0 } },
  properties: { n: { $ref: '#/definitions/pos' }, s: { type: 'string', nullable: true }, e: { enum: ['a', 'b'] } },
  required: ['n'],
};

{
  const counter = { reads: 0 };
  const schema = counted(shape, counter);
  const v = new Validator(schema);
  // `$schema` may be read to learn the dialect; nothing below the root may.
  assert.ok(counter.reads <= 2, 'construction read the schema ' + counter.reads + ' times');
  assert.strictEqual(v.validate({ n: 1, s: null, e: 'a' }).valid, true);
  assert.ok(counter.reads > 2, 'first use read the schema');
  assert.strictEqual(v.validate({ n: -1 }).valid, false, 'the draft-07 definitions ref still applies');
  assert.strictEqual(v.validate({ n: 1, e: 'zzz' }).valid, false);
}

// The same with options that touch the schema up front.
{
  const counter = { reads: 0 };
  const v = new Validator(counted(shape, counter), { assertFormat: false, coerceTypes: true });
  assert.ok(counter.reads <= 2, 'construction with options read the schema ' + counter.reads + ' times');
  // Coercion does not reach through a local `$ref` (unchanged behaviour), so
  // the coerced property is a direct one.
  assert.strictEqual(v.validate({ n: 3, s: 'x', e: 'b' }).valid, true);
  const c = new Validator(counted({ type: 'object', properties: { n: { type: 'integer' } } }, counter), { coerceTypes: true });
  assert.strictEqual(c.validate({ n: '3' }).valid, true, 'coercion applies');
}

// Identity cache and the keywords option keep working.
{
  const plain = { type: 'object', properties: { a: { even: true } } };
  const a = new Validator(plain);
  assert.strictEqual(new Validator(plain), a, 'identity cache');
  const k = new Validator(plain, { keywords: { even: (s, d) => !s || d % 2 === 0 } });
  assert.strictEqual(k.validate({ a: 3 }).valid, false);
  assert.strictEqual(k.engine(), 'interpreter');
}

console.log('ok: construction does not walk the schema');

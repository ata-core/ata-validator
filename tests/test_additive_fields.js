'use strict';

const assert = require('node:assert');
const { Validator } = require('..');

const schema = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
  additionalProperties: false,
};

// detail states the observation; message keeps its parity wording.
{
  const v = new Validator({ type: 'object', properties: { age: { type: 'integer' } } }, { allErrors: true });
  const e = v.validate({ age: 'x' }).errors[0];
  assert.strictEqual(e.message, 'must be integer', 'message must not change');
  assert.strictEqual(e.detail, 'expected integer, found string', 'detail states what was found');
  assert.strictEqual(typeof e.rank, 'number', 'rank is a number');
  console.log('ok: detail and rank present');
}

// related is symmetric, in range, and only set for a resolved pair.
{
  const v = new Validator(schema, { allErrors: true });
  const errs = v.validate({ nmae: 'Mert' }).errors;
  const reqIdx = errs.findIndex((e) => e.keyword === 'required');
  const addIdx = errs.findIndex((e) => e.keyword === 'additionalProperties');
  assert.ok(reqIdx >= 0 && addIdx >= 0, 'both halves of the pair are present');
  assert.deepStrictEqual(errs[reqIdx].related, [addIdx], 'required points at the extra key');
  assert.deepStrictEqual(errs[addIdx].related, [reqIdx], 'extra key points back');
  assert.strictEqual(errs.length, 2, 'correlation must not change the array length');
  console.log('ok: related is symmetric and non-destructive');
}

// An unambiguous non-pair gets no related field at all.
{
  const v = new Validator({ type: 'object', properties: { age: { type: 'integer' } } }, { allErrors: true });
  const e = v.validate({ age: 'x' }).errors[0];
  assert.strictEqual(e.related, undefined, 'unrelated errors carry no related field');
  console.log('ok: no spurious related field');
}

// anchor is populated on the text path, where real positions exist.
{
  const v = new Validator(schema, { allErrors: true });
  const errs = v.validateJSON('{\n  "nmae": "Mert"\n}').errors;
  const add = errs.find((e) => e.keyword === 'additionalProperties');
  assert.ok(add.anchor, 'anchor present on the text path');
  assert.strictEqual(add.anchor.keyLine, 2, 'anchor knows where the key token is');
  console.log('ok: anchor carries the key token position');
}

// richErrors:false gains nothing. This mirrors test_rich_errors_optout.js and
// exists so a regression is caught here too, next to the new fields.
{
  const V0_14 = new Set(['keyword', 'instancePath', 'schemaPath', 'params', 'message', 'parentSchema']);
  const v = new Validator(schema, { allErrors: true, richErrors: false });
  for (const e of v.validate({ nmae: 'Mert' }).errors) {
    for (const k of Object.keys(e)) {
      assert.ok(V0_14.has(k), `richErrors:false leaked "${k}"`);
    }
  }
  console.log('ok: richErrors:false unchanged');
}

console.log('ok: additive fields');

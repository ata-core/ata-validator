'use strict';

const assert = require('node:assert');
const { Validator, attachSuggestions } = require('..');

const KEY = Symbol.for('ata.diagnosticSource');
const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };

// The symbol rides on the array and is invisible to every observation a
// downstream consumer can make.
{
  const v = new Validator(schema, { allErrors: true });
  const errs = v.validate({}).errors;
  const src = errs[KEY];
  assert.ok(src, 'source payload attached');
  assert.deepStrictEqual(src.data, {}, 'payload carries the data');
  assert.strictEqual(Object.keys(errs).length, errs.length, 'symbol is not an own enumerable key');
  assert.ok(!JSON.stringify(errs).includes('diagnosticSource'), 'symbol does not serialize');
  assert.strictEqual(errs.length, 1, 'length unchanged');
  console.log('ok: symbol attached invisibly');
}

// validateJSON carries the original text, which is the faithful frame source.
{
  const v = new Validator(schema, { allErrors: true });
  const json = '{\n  "x": 1\n}';
  const errs = v.validateJSON(json).errors;
  assert.strictEqual(errs[KEY].text, json, 'payload carries the original text');
  assert.deepStrictEqual(errs[KEY].data, { x: 1 }, 'and still carries the parsed data');
  assert.ok(errs[KEY].schema, 'and the schema');
  console.log('ok: text path carries its text');
}

// A schema with no defaults, no coercion and no removal does not mutate, so
// frames may be synthesized from the object. The flag is computed when the
// validator compiles, which is lazy, so it is read after the first call.
{
  const v = new Validator(schema, { allErrors: true });
  const r = v.validate({});
  assert.strictEqual(v._mutatesInput, false, 'plain schema does not mutate input');
  assert.strictEqual(r.errors[KEY].mutatesInput, false);
  console.log('ok: non-mutating schema is marked safe');
}

// A schema carrying a default DOES mutate, because useDefaults is on by
// default. Frames must not be synthesized from data that gained a key the
// caller never sent.
{
  const withDefault = { type: 'object', properties: { a: { type: 'string', default: 'INJ' }, b: { type: 'integer' } } };
  const v = new Validator(withDefault, { allErrors: true });
  const d = { b: 'nope' };
  const r = v.validate(d);
  assert.strictEqual(v._mutatesInput, true, 'a default makes the validator mutating');
  assert.strictEqual(r.errors[KEY].mutatesInput, true);
  assert.strictEqual(d.a, 'INJ', 'and it really did mutate');
  console.log('ok: defaults mark the validator mutating');
}

// coerceTypes marks it too.
{
  const v = new Validator({ type: 'object', properties: { p: { type: 'integer' } } }, { allErrors: true, coerceTypes: true });
  v.validate({ p: 'x' });
  assert.strictEqual(v._mutatesInput, true, 'coerceTypes makes the validator mutating');
  console.log('ok: coerceTypes marks the validator mutating');
}

// attachSuggestions is the AOT bridge: it must attach the payload too, since
// modules built by `ata build` import nothing and cannot do it themselves.
{
  const errs = [{ code: 'ATA1001', keyword: 'type', path: '/a', instancePath: '/a', params: { type: 'string' }, message: 'must be string' }];
  attachSuggestions(errs, { a: 1 });
  assert.ok(errs[KEY], 'attachSuggestions attaches the payload');
  assert.deepStrictEqual(errs[KEY].data, { a: 1 });
  console.log('ok: AOT bridge attaches the payload');
}

// A frozen array must never make the error path throw.
{
  const frozen = Object.freeze([]);
  assert.doesNotThrow(() => attachSuggestions(frozen, {}), 'frozen array must not throw');
  console.log('ok: frozen array tolerated');
}

console.log('ok: diagnostic source');

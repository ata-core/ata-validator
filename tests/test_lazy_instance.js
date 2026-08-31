'use strict';

// The public methods and "~standard" live on the prototype as memoized
// accessors: a fresh Validator carries none of them as own properties, so a
// validator that is constructed but never used stays small. These tests pin
// that shape and the behaviors that must survive it.

const assert = require('assert');
const { Validator } = require('../index.js');

let pass = 0;
function ok(name, fn) {
  fn();
  pass++;
  console.log('  PASS ', name);
}

const schema = () => ({
  type: 'object',
  properties: { a: { type: 'number' }, b: { type: 'string' } },
  required: ['a'],
});

const METHODS = ['validate', 'isValidObject', 'validateJSON', 'isValidJSON',
  'validateAndParse', 'isValid', 'countValid', 'batchIsValid'];

ok('a fresh instance owns no method properties', () => {
  const v = new Validator(schema());
  for (const m of METHODS) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(v, m), false, m);
  }
  assert.strictEqual(Object.prototype.hasOwnProperty.call(v, '~standard'), false);
});

ok('methods still answer through the prototype', () => {
  const v = new Validator(schema());
  assert.strictEqual(v.validate({ a: 1 }).valid, true);
  assert.strictEqual(v.validate({ b: 'x' }).valid, false);
  assert.strictEqual(new Validator(schema()).isValidJSON('{"a":2}'), true);
});

ok('a method read before compilation stays callable detached', () => {
  const v = new Validator(schema());
  const f = v.validate;
  assert.strictEqual(f({ a: 1 }).valid, true);
  assert.strictEqual(f({}).valid, false);
});

ok('reading a method twice returns the same function', () => {
  const v = new Validator(schema());
  assert.strictEqual(v.validate, v.validate);
});

ok('plain assignment before any read still works', () => {
  const v = new Validator(schema());
  const marker = () => 'mine';
  v.validate = marker;
  assert.strictEqual(v.validate, marker);
  assert.strictEqual(v.validate(), 'mine');
});

ok('~standard is memoized, frozen and non-enumerable', () => {
  const v = new Validator(schema());
  const std = v['~standard'];
  assert.strictEqual(std, v['~standard']);
  assert.strictEqual(Object.isFrozen(std), true);
  assert.strictEqual(std.vendor, 'ata-validator');
  assert.strictEqual(Object.keys(v).includes('~standard'), false);
  const good = std.validate({ a: 1 });
  assert.deepStrictEqual(good, { value: { a: 1 } });
  const bad = std.validate({});
  assert.strictEqual(Array.isArray(bad.issues), true);
});

ok('the position cache is not allocated until the JSON text path runs', () => {
  const v = new Validator(schema());
  v.validate({ a: 1 });
  assert.strictEqual(v._posCache, null);
});

console.log(`${pass}/7 lazy-instance tests passed.`);

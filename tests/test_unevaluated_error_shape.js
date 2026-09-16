'use strict';

// `unevaluatedProperties: false` used to report the boolean schema that sits
// under the keyword rather than the keyword itself: keyword `not`, empty
// params, and an instancePath pointing at the offending member instead of the
// object holding it. Nothing in that error says which key was unexpected, so a
// caller that branches on `params.unevaluatedProperty` to flag unknown keys saw
// nothing at all. `unevaluatedItems: false` had the same shape, one error per
// trailing element.
//
// The shape here is the one the default error format defines, and it is what
// `ata-validator/compat` promises to match. Found by a migration that read
// `err.params.unevaluatedProperty` and got undefined.

const assert = require('node:assert');
const { Validator } = require('../index');
const { createInterpreter } = require('../lib/interpreter');
const Compat = require('../compat.js');

let passed = 0;
function ok(name) { console.log('  PASS  ' + name); passed++; }

// --- properties -------------------------------------------------------------
{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false };
  const errors = new Validator(schema).validate({ a: 'x', b: 1, c: 2 }).errors;
  assert.strictEqual(errors.length, 2, 'one error per unevaluated key');
  for (const e of errors) {
    assert.strictEqual(e.keyword, 'unevaluatedProperties');
    assert.strictEqual(e.instancePath, '', 'the error belongs to the object, not the member');
    assert.strictEqual(e.schemaPath, '#/unevaluatedProperties');
    assert.strictEqual(e.message, 'must NOT have unevaluated properties');
  }
  assert.deepStrictEqual(
    errors.map((e) => e.params.unevaluatedProperty).sort(),
    ['b', 'c'],
    'each error names the key it rejected',
  );
  ok('unevaluatedProperties: false names the key on the object holding it');
}

// --- items ------------------------------------------------------------------
{
  const schema = { type: 'array', prefixItems: [{ type: 'integer' }], unevaluatedItems: false };
  const errors = new Validator(schema).validate([1, 2, 3]).errors;
  assert.strictEqual(errors.length, 1, 'one error for the array, not one per element');
  const [e] = errors;
  assert.strictEqual(e.keyword, 'unevaluatedItems');
  assert.strictEqual(e.instancePath, '');
  assert.strictEqual(e.schemaPath, '#/unevaluatedItems');
  assert.deepStrictEqual(e.params, { limit: 1 });
  assert.strictEqual(e.message, 'must NOT have more than 1 items');
  ok('unevaluatedItems: false reports the array length past the last evaluated position');
}

// --- a schema value still reports from that schema ---------------------------
{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: { type: 'integer' } };
  const errors = new Validator(schema).validate({ a: 'x', b: 'not an integer' }).errors;
  assert.ok(errors.some((e) => e.keyword === 'type' && e.instancePath === '/b'),
    'a subschema value keeps reporting from inside itself');
  assert.ok(!errors.some((e) => e.keyword === 'unevaluatedProperties'),
    'and does not synthesise a keyword error of its own');
  ok('unevaluatedProperties as a schema is unchanged');
}

// --- nested, the shape a config schema actually has -------------------------
{
  const schema = {
    type: 'object',
    properties: { defs: { type: 'object', additionalProperties: { $ref: '#/$defs/entry' } } },
    $defs: { entry: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'], unevaluatedProperties: false } },
  };
  const errors = new Validator(schema).validate({ defs: { API_URL: { description: 'x', typo: 1 } } }).errors;
  const hit = errors.find((e) => e.keyword === 'unevaluatedProperties');
  assert.ok(hit, 'the keyword error survives a $ref and two levels of nesting');
  assert.strictEqual(hit.instancePath, '/defs/API_URL');
  assert.strictEqual(hit.params.unevaluatedProperty, 'typo');
  ok('a nested unevaluated key reports at its own object');
}

// --- both engines agree -----------------------------------------------------
{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false };
  const data = { a: 'x', b: 1 };
  const interp = createInterpreter(schema, {});
  const shape = (errs) => errs.map((e) => `${e.keyword}@${e.instancePath}:${JSON.stringify(e.params)}`).sort();
  assert.deepStrictEqual(
    shape(new Validator(schema).validate(data).errors),
    shape(interp.validate(data).errors),
    'the compiled and interpreted engines report the same error',
  );
  ok('both engines report the same unevaluated error');
}

// --- verbose carries data and schema, and only under verbose ----------------
{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['b'] };
  const verbose = new Validator(schema, { verbose: true }).validate({ a: 1 }).errors;
  const byKeyword = Object.fromEntries(verbose.map((e) => [e.keyword, e]));
  assert.deepStrictEqual(byKeyword.type.data, 1, 'data is the value the error points at');
  assert.strictEqual(byKeyword.type.schema, 'string', 'schema is the failing keyword\'s own value');
  assert.deepStrictEqual(byKeyword.required.data, { a: 1 });
  assert.deepStrictEqual(byKeyword.required.schema, ['b']);
  assert.ok(byKeyword.type.parentSchema !== undefined, 'parentSchema is still there');

  const plain = new Validator(schema).validate({ a: 1 }).errors;
  for (const e of plain) {
    assert.ok(!('data' in e), 'the default shape does not grow a data key');
    assert.ok(!('schema' in e), 'the default shape does not grow a schema key');
  }
  ok('verbose attaches data and schema, and nothing else does');
}

// --- through the compat entry, which is where the promise is made -----------
{
  const schema = {
    type: 'object',
    properties: { flag: { type: 'object', properties: { on: { type: 'boolean' } }, if: { required: ['on'] }, then: { required: ['why'] }, unevaluatedProperties: false } },
  };
  const ajvLike = new Compat({ allErrors: true, strict: false, verbose: true });
  const validate = ajvLike.compile(schema);
  validate({ flag: { on: true, stray: 1 } });
  const errs = validate.errors || [];
  const hit = errs.find((e) => e.keyword === 'unevaluatedProperties');
  assert.ok(hit, 'compat reports the keyword');
  assert.strictEqual(hit.instancePath, '/flag');
  assert.strictEqual(hit.params.unevaluatedProperty, 'stray');
  for (const e of errs) {
    assert.ok('data' in e, `every verbose error carries data, including a synthesised one (${e.keyword})`);
  }
  ok('compat reports the keyword and carries data on every error');
}

console.log(`\n${passed} passed, 0 failed`);

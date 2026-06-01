'use strict';

// Custom error messages: a subschema may carry an `errorMessage` keyword that
// overrides the generated `message` on any error it owns. Supported forms:
//   errorMessage: "one message for any failure of this subschema"
//   errorMessage: { <keyword>: "msg", required: "msg" | { prop: "msg" }, _: "fallback" }
// The override is applied after enrichment, so `code`/`keyword`/`path` stay intact
// and only `message` changes. Errors are cloned, never mutated.

const assert = require('assert');
const { Validator } = require('../index.js');

let passed = 0;
function ok (name, cond) {
  assert.ok(cond, name);
  passed++;
}

// 1. String form overrides the message for any keyword on that subschema.
{
  const v = new Validator({
    type: 'object',
    properties: {
      age: { type: 'integer', minimum: 18, errorMessage: 'age must be a whole number that is at least 18' },
    },
    required: ['age'],
  });

  const r1 = v.validate({ age: 5 });
  ok('string form: minimum fails', !r1.valid);
  ok('string form: minimum message overridden',
    r1.errors.some((e) => e.message === 'age must be a whole number that is at least 18'));

  const r2 = v.validate({ age: 'old' });
  ok('string form: type fails', !r2.valid);
  ok('string form: type message overridden too (same subschema)',
    r2.errors.some((e) => e.message === 'age must be a whole number that is at least 18'));

  // The override only touches `message`; code/keyword/path survive.
  const e = r1.errors.find((x) => x.message === 'age must be a whole number that is at least 18');
  ok('string form: keyword preserved', e.keyword === 'minimum');
  ok('string form: path preserved', (e.path || e.instancePath) === '/age');
}

// 2. Per-keyword object form.
{
  const v = new Validator({
    type: 'object',
    properties: {
      age: {
        type: 'integer',
        minimum: 18,
        errorMessage: { minimum: 'too young', type: 'age has to be a number' },
      },
    },
    required: ['age'],
  });

  const r1 = v.validate({ age: 5 });
  ok('object form: minimum -> custom', r1.errors.some((e) => e.message === 'too young'));

  const r2 = v.validate({ age: true });
  ok('object form: type -> custom', r2.errors.some((e) => e.message === 'age has to be a number'));
}

// 3. required: keyed by missing property name, plus string form.
{
  const v = new Validator({
    type: 'object',
    properties: { email: { type: 'string' }, name: { type: 'string' } },
    required: ['email', 'name'],
    errorMessage: { required: { email: 'we need your email', name: 'name is required' } },
  });

  const r = v.validate({});
  ok('required map: email message', r.errors.some((e) => e.message === 'we need your email'));
  ok('required map: name message', r.errors.some((e) => e.message === 'name is required'));
}

{
  const v = new Validator({
    type: 'object',
    properties: { token: { type: 'string' } },
    required: ['token'],
    errorMessage: { required: 'a required field is missing' },
  });
  const r = v.validate({});
  ok('required string: applies to any missing prop', r.errors.some((e) => e.message === 'a required field is missing'));
}

// 4. `_` fallback for keywords without a specific override.
{
  const v = new Validator({
    type: 'object',
    properties: {
      code: { type: 'string', minLength: 3, pattern: '^[A-Z]+$', errorMessage: { minLength: 'too short', _: 'invalid code' } },
    },
  });
  const r = v.validate({ code: 'ab' });
  // 'ab' fails both minLength (-> "too short") and pattern (-> fallback "invalid code")
  ok('fallback: minLength specific', r.errors.some((e) => e.message === 'too short'));
  ok('fallback: pattern uses _', r.errors.some((e) => e.message === 'invalid code'));
}

// 5. additionalProperties at the object level.
{
  const v = new Validator({
    type: 'object',
    properties: { id: { type: 'integer' } },
    additionalProperties: false,
    errorMessage: { additionalProperties: 'unknown field not allowed' },
  });
  const r = v.validate({ id: 1, extra: true });
  ok('additionalProperties override', r.errors.some((e) => e.message === 'unknown field not allowed'));
}

// 6. Schemas without errorMessage are untouched (zero behavioral change).
{
  const v = new Validator({ type: 'object', properties: { age: { type: 'integer', minimum: 18 } } });
  const r = v.validate({ age: 1 });
  ok('no errorMessage: default message intact', r.errors.every((e) => typeof e.message === 'string' && e.message.length > 0));
  ok('no errorMessage: not our custom text', !r.errors.some((e) => e.message === 'too young'));
}

// 7. validateAndParse and validateJSON also apply overrides.
{
  const v = new Validator({
    type: 'object',
    properties: { age: { type: 'integer', minimum: 18, errorMessage: 'bad age' } },
    required: ['age'],
  });
  const rp = v.validateAndParse('{"age":1}');
  ok('validateAndParse: override applied', rp.errors.some((e) => e.message === 'bad age'));

  const rj = v.validateJSON('{"age":1}');
  ok('validateJSON: override applied', rj.errors.some((e) => e.message === 'bad age'));
}

// 8. richErrors:false still gets overrides (message is overridden regardless of shape).
{
  const v = new Validator(
    { type: 'object', properties: { age: { type: 'integer', minimum: 18, errorMessage: 'bad age' } }, required: ['age'] },
    { richErrors: false },
  );
  const r = v.validate({ age: 1 });
  ok('richErrors:false: override applied', r.errors.some((e) => e.message === 'bad age'));
}

console.log(`test_error_messages: ${passed} assertions passed`);

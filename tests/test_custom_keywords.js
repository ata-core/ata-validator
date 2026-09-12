'use strict';

// Custom keywords: `new Validator(schema, { keywords })`. A keyword is a
// name plus one of `validate(value, data, parentSchema, ctx)`,
// `compile(value, parentSchema) -> (data) => boolean`, or
// `macro(value, parentSchema) -> schema`. Schemas that use one always run on
// the interpreted engine, so every applicator (anyOf, not, $ref, ...) keeps
// its spec semantics around the custom check.

const { Validator } = require('../index');
const { bufferNeedsSlowPath } = require('../lib/buffer-gate');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const even = { validate: (value, data) => !value || data % 2 === 0 };

console.log('\ncustom keywords\n');

test('validate-form keyword rejects and names the keyword', () => {
  const v = new Validator(
    { type: 'object', properties: { a: { even: true } } },
    { keywords: { even } },
  );
  assert(v.validate({ a: 2 }).valid === true, 'even value accepted');
  const r = v.validate({ a: 3 });
  assert(r.valid === false, 'odd value rejected');
  assert(r.errors.length === 1, 'one error, got ' + r.errors.length);
  assert(r.errors[0].keyword === 'even', 'keyword is even, got ' + r.errors[0].keyword);
  assert(r.errors[0].instancePath === '/a', 'instancePath /a, got ' + r.errors[0].instancePath);
  assert(r.errors[0].message === 'must pass "even" keyword validation', 'default message, got ' + r.errors[0].message);
  assert(r.errors[0].schemaPath === '#/properties/a/even', 'schemaPath, got ' + r.errors[0].schemaPath);
});

test('keyword with `type` only runs on data of that type', () => {
  const v = new Validator(
    { properties: { a: { even: true } } },
    { keywords: { even: { type: 'number', validate: even.validate } } },
  );
  assert(v.validate({ a: 'three' }).valid === true, 'string is not checked by a number keyword');
  assert(v.validate({ a: 3 }).valid === false, 'number is checked');
});

test('the same keyword without `type` sees every value', () => {
  const v = new Validator(
    { properties: { a: { even: true } } },
    { keywords: { even } },
  );
  // 'three' % 2 is NaN, which is not 0, so an untyped keyword rejects it.
  assert(v.validate({ a: 'three' }).valid === false);
});

test('compile-form keyword builds the check once per schema value', () => {
  let compiled = 0;
  const v = new Validator(
    { properties: { a: { maxWords: 2 }, b: { maxWords: 3 } } },
    {
      keywords: {
        maxWords: {
          type: 'string',
          compile(n) {
            compiled++;
            return (data) => data.split(/\s+/).length <= n;
          },
        },
      },
    },
  );
  assert(v.validate({ a: 'one two', b: 'one two three' }).valid === true);
  assert(v.validate({ a: 'one two three' }).valid === false);
  assert(v.validate({ b: 'one two three four' }).valid === false);
  assert(compiled === 2, 'compiled twice, got ' + compiled);
});

test('macro-form keyword expands into a schema before compilation', () => {
  const v = new Validator(
    { properties: { a: { type: 'number', range: [1, 5] } } },
    { keywords: { range: { macro: ([min, max]) => ({ minimum: min, maximum: max }) } } },
  );
  assert(v.validate({ a: 3 }).valid === true);
  const r = v.validate({ a: 9 });
  assert(r.valid === false);
  assert(r.errors[0].keyword === 'maximum', 'the expansion reports its own keyword, got ' + r.errors[0].keyword);
  assert(r.errors[0].schemaPath === '#/properties/a/range/maximum', 'expansion path under the keyword, got ' + r.errors[0].schemaPath);
  assert(r.errors.length === 2 && r.errors[1].keyword === 'range', 'the keyword adds its own error, got ' + JSON.stringify(r.errors.map((e) => e.keyword)));
  assert(v.isValidObject({ a: 9 }) === false && v.isValidObject({ a: 2 }) === true, 'verdict path agrees');
});

test('a keyword inside anyOf does not fail the whole schema when another branch passes', () => {
  const v = new Validator(
    { anyOf: [{ even: true }, { type: 'string' }] },
    { keywords: { even: { type: 'number', validate: even.validate } } },
  );
  assert(v.validate(4).valid === true);
  assert(v.validate('x').valid === true);
  assert(v.validate(3).valid === false);
});

test('a keyword under not is inverted', () => {
  const v = new Validator({ not: { even: true } }, { keywords: { even: { type: 'number', validate: even.validate } } });
  assert(v.validate(3).valid === true);
  assert(v.validate(4).valid === false);
});

test('a keyword reached through $ref is applied', () => {
  const v = new Validator(
    { $defs: { e: { even: true } }, items: { $ref: '#/$defs/e' } },
    { keywords: { even: { type: 'number', validate: even.validate } } },
  );
  assert(v.validate([2, 4]).valid === true);
  const r = v.validate([2, 3]);
  assert(r.valid === false);
  assert(r.errors[0].instancePath === '/1', 'instancePath /1, got ' + r.errors[0].instancePath);
});

test('keyword errors: the function may supply its own error objects', () => {
  const kw = {
    validate: function check(value, data) {
      if (data >= value) return true;
      check.errors = [{ keyword: 'atLeast', message: `must be at least ${value}`, params: { limit: value } }];
      return false;
    },
  };
  const v = new Validator({ properties: { n: { atLeast: 10 } } }, { keywords: { atLeast: kw } });
  const r = v.validate({ n: 4 });
  assert(r.valid === false);
  assert(r.errors[0].message === 'must be at least 10', 'custom message, got ' + r.errors[0].message);
  assert(r.errors[0].instancePath === '/n', 'instancePath filled in, got ' + r.errors[0].instancePath);
  assert(r.errors[0].params.limit === 10);
  assert(v.validate({ n: 12 }).valid === true, 'stale errors do not leak into the next call');
});

test('a function is shorthand for the validate form', () => {
  const v = new Validator({ properties: { a: { even: true } } }, { keywords: { even: even.validate } });
  assert(v.validate({ a: 3 }).valid === false);
});

test('verdict paths agree with validate()', () => {
  const v = new Validator({ properties: { a: { even: true } } }, { keywords: { even } });
  assert(v.isValidObject({ a: 2 }) === true);
  assert(v.isValidObject({ a: 3 }) === false);
  assert(v.isValidJSON('{"a":3}') === false);
  assert(v.validateJSON('{"a":3}').valid === false);
});

test('schemas with custom keywords run on the interpreted engine', () => {
  const v = new Validator({ properties: { a: { even: true } } }, { keywords: { even } });
  v.validate({ a: 2 });
  assert(v.engine() === 'interpreter', 'engine is ' + v.engine());
});

test('a schema that does not use any registered keyword is unaffected', () => {
  const v = new Validator({ properties: { a: { type: 'number' } } }, { keywords: { even } });
  assert(v.validate({ a: 3 }).valid === true);
});

test('the buffer APIs route away from the native walker', () => {
  assert(bufferNeedsSlowPath({ properties: { a: { even: true } } }, null, { even }) === true);
  assert(bufferNeedsSlowPath({ properties: { a: { type: 'number' } } }, null, { even }) === false);
});

test('bundleStandalone refuses custom keywords instead of dropping them', () => {
  let threw = null;
  try {
    Validator.bundleStandalone([{ properties: { a: { even: true } } }], { keywords: { even } });
  } catch (e) {
    threw = e;
  }
  assert(threw && /keywords/.test(threw.message), 'throws mentioning keywords, got ' + (threw && threw.message));
});

test('the other emitters refuse custom keywords too', () => {
  const schema = { properties: { a: { even: true } } };
  const throws = (fn) => { try { fn(); } catch (e) { return /keywords/.test(e.message); } return false; };
  assert(throws(() => Validator.bundle([schema], { keywords: { even } })), 'bundle');
  assert(throws(() => Validator.bundleCompact([schema], { keywords: { even } })), 'bundleCompact');
  const { toStandalone, toStandaloneModule } = require('../lib/aot');
  assert(throws(() => toStandalone(new Validator(schema, { keywords: { even } }))), 'toStandalone');
  assert(throws(() => toStandaloneModule(new Validator(schema, { keywords: { even } }), { format: 'esm' })), 'toStandaloneModule');
  // A validator that registers keywords but whose schema uses none still compiles.
  assert(typeof toStandalone(new Validator({ type: 'string' }, { keywords: { even } })) === 'string', 'unused keywords do not block emission');
});

test('a keyword definition with none of validate, compile or macro is rejected', () => {
  let threw = null;
  try {
    new Validator({ even: true }, { keywords: { even: { code: () => {} } } });
  } catch (e) {
    threw = e;
  }
  assert(threw && /even/.test(threw.message), 'throws naming the keyword, got ' + (threw && threw.message));
});

console.log(`\n${passed}/${passed + failed} tests passed.\n`);
process.exit(failed > 0 ? 1 : 0);

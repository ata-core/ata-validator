'use strict';

const assert = require('assert');
const { Validator } = require('..');

const schema = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0 },
  },
  required: ['email'],
};

// Functional: abortEarly returns ATA9000 with no rich fields
{
  const v = new Validator(schema, { abortEarly: true });
  const r = v.validate({ email: 'nope', age: -1 });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].code, 'ATA9000');
  assert.strictEqual(r.errors[0].dataFrame, undefined);
  assert.strictEqual(r.errors[0].suggestion, undefined);
  assert.strictEqual(r.errors[0].schemaSource, undefined);
}

// Perf: abortEarly should be within 10% of v0.14 baseline.
// We don't have v0.14 in-process; instead, assert abortEarly is at least 3x
// faster than full validation (sanity-check that the short-circuit is real).
// Use fresh schema objects so the validator identity cache doesn't hand the
// "full" variable a previously-cached abortEarly instance.
{
  const schemaFull = JSON.parse(JSON.stringify(schema));
  const schemaAbort = JSON.parse(JSON.stringify(schema));
  const vFull = new Validator(schemaFull);
  const vAbort = new Validator(schemaAbort, { abortEarly: true });
  const bad = { email: 'nope', age: -1 };
  const N = 50000;

  // Warm
  for (let i = 0; i < 1000; i++) { vFull.validate(bad); vAbort.validate(bad); }

  // Since errors are materialized on first read, the default path does no
  // error work when only `.valid` is consumed, so abortEarly's edge shows
  // against a caller that actually reads the errors.
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { const r = vFull.validate(bad); if (r.errors.length === 0) throw new Error('expected errors'); }
  const dFull = Number(process.hrtime.bigint() - t1);

  const t2 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) vAbort.validate(bad);
  const dAbort = Number(process.hrtime.bigint() - t2);

  const ratio = dFull / dAbort;
  console.log(`abortEarly speedup vs full+read: ${ratio.toFixed(2)}x (full ${(dFull/1e6).toFixed(1)}ms, abort ${(dAbort/1e6).toFixed(1)}ms over ${N} ops)`);
  assert.ok(ratio > 3, `abortEarly should be >3x faster than reading enriched errors, got ${ratio.toFixed(2)}x`);

  // And the verdict-only default path must now be in abortEarly's class:
  // within 3x, where it used to be 10x and more behind.
  const t3 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) vFull.validate(bad);
  const dVerdict = Number(process.hrtime.bigint() - t3);
  const vRatio = dVerdict / dAbort;
  console.log(`default verdict vs abortEarly: ${vRatio.toFixed(2)}x`);
  assert.ok(vRatio < 3, `reading only .valid should cost about what abortEarly costs, got ${vRatio.toFixed(2)}x`);
}

console.log('ok: abortEarly regression');

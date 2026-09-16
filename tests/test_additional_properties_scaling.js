'use strict';

// `additionalProperties: false` used to compile to a comparison per declared
// name, per key of the document: quadratic in the number of properties. A
// 1000-property config schema spent 75 us per document where the same schema
// without the keyword took 3, and doubling the properties quadrupled that.
// Found by a config linter whose schema is generated from a project's
// environment variables and feature flags, so its property count is whatever
// the project has.
//
// The guard is structural: the generated code must read a hoisted lookup rather
// than test the key against every declared name, and must build that lookup
// outside the function that runs per call. That holds whatever the machine is
// doing.
//
// There is no timing assertion. The first version of this test asserted that
// four times the properties cost less than eight times the time, and it was
// wrong twice over: a CI runner measured 8.3x for the fixed code, and the
// quadratic code it was supposed to catch measured 7.7x on the machine it was
// written on, because the comparison chain short-circuits on a match and the
// linear part of the work dilutes the ratio. A bound that a regression can
// pass and a fix can fail is not a guard. The numbers are still printed, since
// they are worth reading in a CI log.

const assert = require('node:assert');
const { Validator } = require('../index');
const { toStandaloneModule } = require('../build.js');

let passed = 0;
function ok(name) { console.log('  PASS  ' + name); passed++; }

function build(n) {
  const properties = {}, data = {};
  for (let i = 0; i < n; i++) { properties['k' + i] = { type: 'string' }; data['k' + i] = 'v'; }
  return { schema: { type: 'object', properties, additionalProperties: false }, data };
}

// --- the verdict is still right at every size -------------------------------
for (const n of [1, 8, 127, 128, 129, 600]) {
  const { schema, data } = build(n);
  const v = new Validator(schema);
  assert.strictEqual(v.isValidObject(data), true, `n=${n}: the declared keys are accepted`);
  assert.strictEqual(v.isValidObject({ ...data, surprise: 1 }), false, `n=${n}: an undeclared key is rejected`);
  assert.strictEqual(v.validate({ ...data, surprise: 1 }).errors[0].params.additionalProperty, 'surprise',
    `n=${n}: the error still names the key`);
}
ok('the verdict and the error are unchanged on both sides of the threshold');

// --- the generated code switches shape --------------------------------------
{
  const small = toStandaloneModule(build(8).schema, {});
  const large = toStandaloneModule(build(600).schema, {});
  assert.ok(!/_apn\d+=Object\.create\(null\)/.test(small),
    'a small schema keeps the comparison chain, which allocates nothing');
  assert.ok(/_apn\d+=Object\.create\(null\)/.test(large),
    'a large schema builds a name lookup');
  // The lookup has to be built once per compiled function. If it ends up
  // inside the returned validator it is rebuilt on every call, which is the
  // other half of this bug.
  const afterReturn = large.slice(large.indexOf('return function'));
  assert.ok(!/_apn\d+=Object\.create\(null\)/.test(afterReturn),
    'and builds it outside the function that runs per call');
  ok('the generated code uses a hoisted lookup only where it pays');
}

// --- the same disguise on unevaluatedProperties ------------------------------
{
  // The static unevaluatedProperties tier used a first-character switch for
  // membership, and keys sharing a first character, ENV_0 through ENV_599
  // here, all land in one case whose body chains every name: the same
  // quadratic, differently dressed. Above the threshold it must use the
  // hoisted lookup too.
  const properties = {};
  for (let i = 0; i < 600; i++) properties['ENV_' + i] = { type: 'string' };
  const big = toStandaloneModule({ type: 'object', properties, unevaluatedProperties: false }, {});
  assert.ok(/_apn\d+=Object\.create\(null\)/.test(big),
    'a large unevaluatedProperties: false builds a name lookup');
  const doc = {};
  for (let i = 0; i < 600; i++) doc['ENV_' + i] = 'v';
  const { Validator } = require('../index');
  const v = new Validator({ type: 'object', properties, unevaluatedProperties: false });
  assert.strictEqual(v.isValidObject(doc), true);
  assert.strictEqual(v.isValidObject({ ...doc, surprise: 1 }), false);
  assert.strictEqual(v.validate({ ...doc, surprise: 1 }).errors[0].params.unevaluatedProperty, 'surprise',
    'and the error still names the key');
  ok('unevaluatedProperties uses the hoisted lookup above the threshold');
}

// --- reported, not asserted -------------------------------------------------
{
  const measure = (n) => {
    const { schema, data } = build(n);
    const v = new Validator(schema);
    for (let k = 0; k < 200; k++) v.isValidObject(data);
    const runs = [];
    for (let r = 0; r < 5; r++) {
      const t0 = process.hrtime.bigint();
      const N = 200;
      for (let k = 0; k < N; k++) v.isValidObject(data);
      runs.push(Number(process.hrtime.bigint() - t0) / N);
    }
    runs.sort((a, b) => a - b);
    return runs[2];
  };
  const small = measure(250);
  const large = measure(1000);
  const ratio = large / small;
  console.log(`  250 properties ${(small / 1000).toFixed(2)} us, 1000 properties ${(large / 1000).toFixed(2)} us, ratio ${ratio.toFixed(1)}x`);
}

console.log(`\n${passed} passed, 0 failed`);

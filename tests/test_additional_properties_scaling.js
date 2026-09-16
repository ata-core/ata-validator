'use strict';

// `additionalProperties: false` used to compile to a comparison per declared
// name, per key of the document: quadratic in the number of properties. A
// 1000-property config schema spent 75 us per document where the same schema
// without the keyword took 3, and doubling the properties quadrupled that.
// Found by a config linter whose schema is generated from a project's
// environment variables and feature flags, so its property count is whatever
// the project has.
//
// Two guards here. The structural one says the generated code does the right
// thing, and holds whatever the machine is doing. The timing one says the
// result is not quadratic, with enough room that noise cannot fail it: a
// fourfold increase in properties must not cost more than eight times the
// time, where the old shape cost sixteen.

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

// --- and the result is not quadratic ----------------------------------------
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
  assert.ok(ratio < 8,
    `four times the properties cost ${ratio.toFixed(1)}x the time; quadratic is 16x, linear is 4x`);
  ok('four times the properties does not cost sixteen times the time');
}

console.log(`\n${passed} passed, 0 failed`);

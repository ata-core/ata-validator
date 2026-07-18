'use strict';

// Schemas the JS codegen cannot compile must still validate correctly in
// native-less environments (browser, edge workers, ATA_NO_NATIVE) via the
// interpreted engine. Historically these schemas recursed through the lazy
// stub until the stack overflowed; then they threw a clear error; now they
// validate.

const { spawnSync } = require('child_process');
const path = require('path');

const child = `
  const { Validator } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))});

  let passed = 0, failed = 0;
  function assert(cond, msg) {
    if (cond) passed++;
    else { console.log('  FAIL ' + msg); failed++; }
  }

  function expectVerdicts(schema, cases, label) {
    const v = new Validator(schema);
    for (const [data, want] of cases) {
      let got;
      try {
        got = v.validate(data).valid;
      } catch (e) {
        assert(false, label + ': threw ' + e.constructor.name + ': ' + e.message);
        continue;
      }
      assert(got === want, label + ': ' + JSON.stringify(data) + ' expected ' + want + ', got ' + got);
    }
  }

  console.log('\\nata interpreted-engine fallback tests\\n');

  // properties + patternProperties + additionalProperties interaction
  // (codegen bails on the combination)
  expectVerdicts({
    properties: { foo: { type: 'array', maxItems: 3 }, bar: { type: 'array' } },
    patternProperties: { 'f.o': { minItems: 2 } },
    additionalProperties: { type: 'integer' }
  }, [
    [{ foo: [1, 2] }, true],
    [{ foo: [] }, false],
    [{ foo: [1, 2, 3, 4] }, false],
    [{ fxo: [1, 2] }, true],
    [{ fxo: [] }, false],
    [{ extra: 1 }, true],
    [{ extra: 'x' }, false],
  ], 'properties interaction');

  // cyclic $defs ref (routed off codegen since 4a04fb6)
  expectVerdicts({
    \$defs: { node: { type: 'object', properties: { next: { \$ref: '#/\$defs/node' } } } },
    \$ref: '#/\$defs/node'
  }, [
    [{ next: { next: {} } }, true],
    [{ next: { next: 3 } }, false],
    [{}, true],
  ], 'cyclic defs ref');

  // relative pointer ref into properties
  expectVerdicts({
    properties: { foo: { type: 'integer' }, bar: { \$ref: '#/properties/foo' } }
  }, [
    [{ bar: 3 }, true],
    [{ bar: 'x' }, false],
  ], 'relative pointer ref');

  // unevaluatedProperties with a ref (annotation tracking)
  expectVerdicts({
    \$defs: { base: { properties: { a: { type: 'string' } } } },
    \$ref: '#/\$defs/base',
    properties: { b: { type: 'number' } },
    unevaluatedProperties: false
  }, [
    [{ a: 'x', b: 1 }, true],
    [{ a: 'x', b: 1, c: 2 }, false],
  ], 'unevaluatedProperties via ref');

  // errors carry real details on the interpreted path
  {
    const v = new Validator({
      properties: { foo: { type: 'array' } },
      patternProperties: { 'f.o': { minItems: 2 } },
      additionalProperties: { type: 'integer' }
    });
    const r = v.validate({ foo: 'nope' });
    assert(r.valid === false, 'detail: should be invalid');
    assert(r.errors.length > 0 && r.errors[0].keyword === 'type' && r.errors[0].instancePath === '/foo',
      'detail: expected a type error at /foo, got ' + JSON.stringify(r.errors[0]));
  }

  // validateJSON path works too
  {
    const v = new Validator({
      properties: { foo: { type: 'array' } },
      patternProperties: { 'f.o': { minItems: 2 } },
      additionalProperties: { type: 'integer' }
    });
    assert(v.validateJSON('{"foo":[1,2]}').valid === true, 'validateJSON valid case');
    assert(v.validateJSON('{"foo":1}').valid === false, 'validateJSON invalid case');
    assert(v.validateJSON('{oops').valid === false, 'validateJSON syntax error');
  }

  console.log('\\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
`;

const r = spawnSync(process.execPath, ['-e', child], {
  env: { ...process.env, ATA_NO_NATIVE: '1' },
  encoding: 'utf8',
});

process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) {
  console.error('not ok: interpreted-engine fallback');
  process.exit(1);
}
console.log('ok: interpreted-engine fallback');

// With the native addon present, isValidObject-first on a codegen-bailing
// schema must dispatch to the native engine, not recurse through the stub.
const nativeChild = `
  const { Validator } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))});
  const v = new Validator({
    properties: { foo: { type: 'array', maxItems: 3 } },
    patternProperties: { 'f.o': { minItems: 2 } },
    additionalProperties: { type: 'integer' }
  });
  const ok = v.isValidObject({ foo: [1, 2] });
  const bad = v.isValidObject({ foo: [1, 2, 3, 4] });
  if (ok !== true || bad !== false) {
    console.log('  FAIL isValidObject-first native: got ' + ok + '/' + bad);
    process.exit(1);
  }
`;
const rn = spawnSync(process.execPath, ['-e', nativeChild], { encoding: 'utf8' });
process.stdout.write(rn.stdout || '');
process.stderr.write(rn.stderr || '');
if (rn.status !== 0) {
  console.error('not ok: isValidObject-first with native engine');
  process.exit(1);
}
console.log('ok: isValidObject-first with native engine');

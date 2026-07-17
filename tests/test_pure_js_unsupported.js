'use strict';

// Schemas the JS codegen cannot compile must fail with a clear error in
// native-less environments (browser, edge workers, ATA_NO_NATIVE), not
// recurse through the lazy stub until the stack overflows.

const { spawnSync } = require('child_process');
const path = require('path');

const child = `
  const { Validator } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))});

  let passed = 0, failed = 0;
  function assert(cond, msg) {
    if (cond) passed++;
    else { console.log('  FAIL ' + msg); failed++; }
  }

  function expectClearError(schema, data, label) {
    const v = new Validator(schema);
    try {
      v.validate(data);
      // Reaching here is fine only if the engine actually supports the schema.
      passed++;
    } catch (e) {
      assert(!(e instanceof RangeError), label + ': must not overflow the stack');
      assert(/native/i.test(e.message), label + ': error message should point at the missing native engine, got: ' + e.message);
    }
  }

  console.log('\\nata pure-JS unsupported-schema tests\\n');

  // properties + patternProperties + additionalProperties interaction
  // (codegen bails on the combination)
  expectClearError({
    properties: { foo: { type: 'array', maxItems: 3 }, bar: { type: 'array' } },
    patternProperties: { 'f.o': { minItems: 2 } },
    additionalProperties: { type: 'integer' }
  }, { foo: [1, 2] }, 'properties interaction');

  // cyclic $defs ref (routed off codegen since 4a04fb6)
  expectClearError({
    \$defs: { node: { properties: { next: { \$ref: '#/\$defs/node' } } } },
    \$ref: '#/\$defs/node'
  }, { next: { next: {} } }, 'cyclic defs ref');

  // relative pointer ref into properties
  expectClearError({
    properties: { foo: { type: 'integer' }, bar: { \$ref: '#/properties/foo' } }
  }, { bar: 3 }, 'relative pointer ref');

  // validateJSON path must not recurse either
  {
    const v = new Validator({
      properties: { foo: { type: 'array' } },
      patternProperties: { 'f.o': { minItems: 2 } },
      additionalProperties: { type: 'integer' }
    });
    try {
      v.validateJSON('{"foo":[1,2]}');
      passed++;
    } catch (e) {
      assert(!(e instanceof RangeError), 'validateJSON: must not overflow the stack');
      assert(/native/i.test(e.message), 'validateJSON: clear error, got: ' + e.message);
    }
  }

  // isValidObject called before validate goes through _ensureCodegen; when
  // codegen bails it must fall through to the full compile, not recurse.
  {
    const v = new Validator({
      properties: { foo: { type: 'array', maxItems: 3 } },
      patternProperties: { 'f.o': { minItems: 2 } },
      additionalProperties: { type: 'integer' }
    });
    try {
      v.isValidObject({ foo: [1, 2] });
      passed++;
    } catch (e) {
      assert(!(e instanceof RangeError), 'isValidObject-first: must not overflow the stack');
      assert(/native/i.test(e.message), 'isValidObject-first: clear error, got: ' + e.message);
    }
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
  console.error('not ok: pure-JS unsupported-schema handling');
  process.exit(1);
}
console.log('ok: pure-JS unsupported-schema handling');

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

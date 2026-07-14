'use strict';

// Deprecated in 0.22.0, removed in 1.0: Validator.prototype.toStandalone()
// and toStandaloneModule() must emit exactly one DeprecationWarning per
// method per process, and the ata-validator/build path must stay silent.

const assert = require('assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build.js');

const warnings = [];
const original = process.emitWarning;
process.emitWarning = (msg, type) => { warnings.push({ msg: String(msg), type }); };

try {
  const schema = { type: 'object', properties: { name: { type: 'string' } } };

  const viaBuild = toStandaloneModule(schema, { format: 'cjs' });
  assert.ok(viaBuild && viaBuild.length > 0, 'build free function produces a module');
  assert.strictEqual(warnings.length, 0, 'ata-validator/build path must not warn');

  const v = new Validator(schema);

  v.toStandalone();
  assert.strictEqual(warnings.length, 1, 'first toStandalone() call warns');
  assert.strictEqual(warnings[0].type, 'DeprecationWarning');
  assert.ok(warnings[0].msg.includes('toStandalone()'), 'warning names the method');
  assert.ok(warnings[0].msg.includes('1.0'), 'warning names the removal version');
  assert.ok(warnings[0].msg.includes('ata-validator/build'), 'warning names the replacement');

  v.toStandalone();
  assert.strictEqual(warnings.length, 1, 'repeat calls do not warn again');

  const src = v.toStandaloneModule({ format: 'cjs' });
  assert.ok(src && src.length > 0, 'deprecated method still works in 0.22');
  assert.strictEqual(warnings.length, 2, 'toStandaloneModule() warns separately');

  new Validator(schema).toStandaloneModule({ format: 'cjs' });
  assert.strictEqual(warnings.length, 2, 'one warning per method per process, not per instance');
} finally {
  process.emitWarning = original;
}

console.log('test_deprecation_warnings: ok');

'use strict';

// The renderers ship in the browser entry, where there is no `process`. They
// read it for colour, terminal width and the working directory, and a bare
// read threw a ReferenceError there, so renderPretty failed in every browser.
// Each renderer is called here with the global removed.

const assert = require('assert');
const { Validator, renderPretty, renderCompact, renderJSON } = require('..');

const v = new Validator({ type: 'object', properties: { email: { type: 'string', format: 'email' } }, additionalProperties: false },
  { source: { path: 'schemas/user.json', content: '{\n  "type": "object"\n}' } });
const errors = v.validateJSON('{\n  "email": "mert.example.com",\n  "role": "admin"\n}').errors;
assert.ok(errors.length >= 2);

const withProcess = renderPretty(errors, { color: 'never' });
const saved = globalThis.process;
let out;
try {
  delete globalThis.process;
  assert.strictEqual(typeof process, 'undefined');
  out = {
    pretty: renderPretty(errors, { color: 'never' }),
    prettyAuto: renderPretty(errors),
    compact: renderCompact(errors, { color: 'never' }),
    json: renderJSON(errors),
  };
} finally {
  globalThis.process = saved;
}
assert.strictEqual(out.pretty, withProcess, 'the same output with and without process');
assert.ok(!out.prettyAuto.includes('\x1b['), 'no colour without a terminal');
assert.ok(out.pretty.includes('error[ATA3001]') && out.pretty.includes('input:2:12'));
assert.ok(out.compact.includes('ATA3001'));
assert.ok(JSON.parse(out.json));
console.log('ok: renderers run without process');

'use strict';

// IDNA2008 is a part of the shared error runtime on its own: only a
// `hostname` with a reserved label and an `idn-hostname` reach it
// (lib/formats.js), and it went into every runtime whose schemas had any
// format, 3.4 KB gzipped for an email and a date. It is kept where one of the
// names that reach it is a string anywhere in a schema; a runtime built
// without it answers the other formats as before, and one built with it
// answers hostnames as the Validator does.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Validator } = require('..');
const aot = require('../lib/aot-impl');
const { errorRuntimeSource, runtimeFeatures } = require('../lib/error-runtime');
const ATA_VERSION = require('../lib/version');

const mail = { type: 'object', properties: { a: { type: 'string', format: 'email' }, d: { type: 'string', format: 'date-time' }, u: { type: 'string', format: 'uri' } } };
const host = { type: 'object', properties: { a: { type: 'string', format: 'email' }, h: { type: 'string', format: 'hostname' } } };

assert.strictEqual(runtimeFeatures([mail]).idna, false);
assert.strictEqual(runtimeFeatures([mail]).formats, true);
assert.strictEqual(runtimeFeatures([host]).idna, true);
assert.strictEqual(runtimeFeatures([{ properties: { h: { format: 'idn-hostname' } } }]).idna, true);
// Kept wherever the name is a string: the check does not read the schema.
assert.strictEqual(runtimeFeatures([{ $defs: { f: { enum: ['email', 'hostname'] } } }]).idna, true);
assert.strictEqual(runtimeFeatures([mail, host]).idna, true);

const gz = (s) => zlib.gzipSync(s, { level: 9 }).length;
const without = errorRuntimeSource('cjs', ATA_VERSION, runtimeFeatures([mail]), false);
const withIdna = errorRuntimeSource('cjs', ATA_VERSION, runtimeFeatures([host]), false);
assert.ok(!without.includes('hostnameLabels (') && !/function\s+__ataIdna\s*\(\)\s*\{\s*const/.test(without) && without.includes('built without IDNA'), 'the runtime without the part carries its stub');
assert.ok(gz(withIdna) - gz(without) > 2500, `IDNA is ${gz(withIdna) - gz(without)} bytes of the runtime`);
// A record written before the part existed names no `idna`: it is kept.
assert.ok(errorRuntimeSource('cjs', ATA_VERSION, { formats: true, 'safe-regex': true, defaults: true, 'unique-items': true }, false).length >= withIdna.length);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-idna-'));
let n = 0;
function load(schema) {
  const d = path.join(dir, String(n++)); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'ata-errors.cjs'), errorRuntimeSource('cjs', ATA_VERSION, runtimeFeatures([schema]), false));
  fs.writeFileSync(path.join(d, 'm.cjs'), aot.toCompactModule(new Validator(schema), { format: 'cjs', errorRuntime: './ata-errors.cjs' }));
  return require(path.join(d, 'm.cjs'));
}
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message])]);
let checked = 0;
for (const [schema, docs] of [
  [mail, [{ a: 'a@b.co' }, { a: 'no' }, { a: 'a@xn--nxasmq6b.com', d: '2020-01-01T00:00:00Z', u: 'http://xn--a.example/' }, { d: 'x', u: ' ' }, { a: 'a@[IPv6:::ffff:192.168.1.1]' }]],
  [host, [{ h: 'example.com' }, { h: 'xn--nxasmq6b.com' }, { h: 'xn--a' }, { h: 'xn--X' }, { h: '-a.com', a: 'no' }, { h: 'a'.repeat(64) + '.com' }]],
]) {
  const m = load(schema); const v = new Validator(schema);
  for (const d of docs) { assert.strictEqual(shape(m.validate(d)), shape(v.validate(d)), JSON.stringify(d)); assert.strictEqual(m.isValid(d), v.validate(d).valid); checked++; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`ok: the shared runtime carries IDNA only for a schema that names a hostname format (${gz(withIdna) - gz(without)} bytes gzipped left out otherwise); ${checked} documents answer as the Validator`);

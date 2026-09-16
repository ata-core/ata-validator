'use strict';

// schemaHash: the staleness contract between a build and its compiled
// artifact. The module says which schema it came from; the helper computes
// the same value from the schema a build holds now; inequality means
// recompile. The hash is over canonical JSON, so key order is irrelevant,
// and it is computed from the schema as the caller wrote it, so dialect
// normalization (draft-07 array items, nullable) does not break the
// comparison.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toStandaloneModule, schemaHash } = require('../build.js');

let passed = 0;
function ok(name) { console.log('  PASS  ' + name); passed++; }

function load(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-hash-'));
  const p = path.join(dir, 'm.cjs');
  fs.writeFileSync(p, src);
  const mod = require(p);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
  const mod = load(toStandaloneModule(schema, { format: 'cjs' }));
  assert.strictEqual(typeof mod.schemaHash, 'string');
  assert.match(mod.schemaHash, /^[0-9a-f]{16}$/);
  assert.strictEqual(mod.schemaHash, schemaHash(schema), 'module and helper agree');
  ok('every module carries the hash of its schema');
}

{
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
  const reordered = { required: ['a'], properties: { a: { type: 'string' } }, type: 'object' };
  const edited = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };
  assert.strictEqual(schemaHash(schema), schemaHash(reordered), 'key order is irrelevant');
  assert.notStrictEqual(schemaHash(schema), schemaHash(edited), 'a real edit changes the hash');
  ok('canonical form: reordering is identity, editing is not');
}

{
  // Normalized dialects hash as written, so the round trip holds.
  const d7 = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', items: [{ type: 'string' }] };
  const mod = load(toStandaloneModule(d7, { format: 'cjs' }));
  assert.strictEqual(mod.schemaHash, schemaHash(d7));
  const nullable = { type: 'object', properties: { n: { type: 'integer', nullable: true } } };
  const mod2 = load(toStandaloneModule(nullable, { format: 'cjs' }));
  assert.strictEqual(mod2.schemaHash, schemaHash(nullable));
  ok('dialect normalization does not break the comparison');
}

{
  const esm = toStandaloneModule({ type: 'string' }, { format: 'esm' });
  assert.ok(/export \{[^}]*schemaHash/.test(esm), 'esm modules export it too');
  ok('present in both formats');
}

console.log(`\n${passed} passed, 0 failed`);

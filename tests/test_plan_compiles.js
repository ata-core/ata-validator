'use strict';

// The closure-tree compiler (lib/plan-compiler.js) covers every schema the
// interpreted engine accepts, and the engine falls back to its plain walk when
// the compiler throws: a ReferenceError in a new leaf form once sent every
// schema to the walk, 35% slower, with every test still passing. So the
// compiler must come back with a tree for each schema of the official suite
// and for the schemas the benchmarks run.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createInterpreter } = require('../lib/interpreter.js');

const schemas = [];
for (const dialect of ['draft2020-12', 'draft7', 'draft2019-09', 'draft6', 'draft4']) {
  const dir = path.join(__dirname, 'suite/tests', dialect);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) schemas.push([`${dialect}/${f}: ${g.description}`, g.schema]);
  }
}
schemas.push(['hot bench', { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 100 }, kind: { enum: ['a', 'b', 'c'] }, tags: { type: 'array', items: { type: 'string' }, maxItems: 10 }, address: { type: 'object', properties: { city: { type: 'string' }, zip: { type: 'string', pattern: '^[0-9]{5}$' } }, required: ['city'] }, oneOfField: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }, required: ['id', 'name'], additionalProperties: false }]);

let compiled = 0;
const failed = [];
for (const [name, schema] of schemas) {
  let it;
  try { it = createInterpreter(schema); } catch { continue; }
  let fast;
  try { fast = it._fastRoot(); } catch (e) { failed.push(`${name}: threw ${e.message}`); continue; }
  if (fast === null) { failed.push(`${name}: no tree`); continue; }
  compiled++;
}
assert.strictEqual(failed.length, 0, `${failed.length} schemas fell back to the plain walk, first:\n${failed.slice(0, 5).join('\n')}`);
// 1409 on the 2026-09-18 suite pin; schemas whose remote references the
// interpreter cannot resolve here are skipped above.
assert.ok(compiled > 1200, `too few schemas compiled: ${compiled}`);
console.log(`ok: the closure-tree compiler covers ${compiled} suite schemas, none fall back to the plain walk`);

'use strict';

// lib/plan-source.js emits a verdict function from interpreter plans. Its one
// promise is that wherever it compiles, it answers exactly what the
// interpreted engine answers. This holds it to that over the official suite
// in both dialects, the format suite, and a corpus aimed at the keywords it
// covers with values of every type, and reports how much it compiled, so a
// change that makes it decline everything cannot pass by comparing nothing.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Validator } = require('..');
const { createInterpreter } = require('../lib/interpreter');
const { compileVerdict } = require('../lib/plan-source');

// Where code generation is refused the compiler must decline, not throw, and
// there is nothing further to compare.
try {
  // eslint-disable-next-line no-new-func
  new Function('return 1');
} catch {
  assert.strictEqual(compileVerdict({ type: 'string' }, {}), null, 'declines when code generation is blocked');
  console.log('skip: code generation is blocked; plan-source declines as it should');
  process.exit(0);
}

const DIALECTS = { 'draft2020-12': null, draft7: 'http://json-schema.org/draft-07/schema#' };
const groups = [];
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const base = path.join(__dirname, 'suite/tests', dialect);
  for (const sub of ['', 'optional/format']) {
    const dir = path.join(base, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        const schema = uri && g.schema && typeof g.schema === 'object' && !('$schema' in g.schema) ? { ...g.schema, $schema: uri } : g.schema;
        groups.push([`${dialect}/${sub}${f}: ${g.description}`, schema, g.tests.map((t) => t.data)]);
      }
    }
  }
}

// Values of every JSON type and a few that are not JSON, run against schemas
// built from the covered keywords.
const VALUES = [null, true, false, 0, -0, 1, 1.5, -3, 1e300, NaN, Infinity, '', 'a', 'ab', 'abc', '\u{1F600}', '\u{1F600}\u{1F600}',
  [], [1], [1, 1], [1, 'a'], [[1], [1]], {}, { a: 1 }, { a: 'x', b: 2 }, { toString: 1 }, { a: { b: [] } },
  Object.create(null), Object.create({ a: 1 }), undefined, () => 1];
const corpus = [
  { type: ['string', 'null'] }, { type: 'integer', minimum: 0, exclusiveMaximum: 10, multipleOf: 2 },
  { type: 'number', multipleOf: 0.1 }, { enum: [1, 'a', null, [1], { a: 1 }] }, { const: { a: 1 } }, { const: 0 },
  { minLength: 2, maxLength: 3 }, { pattern: '^a' }, { format: 'email' }, { minItems: 1, maxItems: 2, uniqueItems: true },
  { required: ['a', 'toString'] }, { minProperties: 1, maxProperties: 1 }, { dependentRequired: { a: ['b'] } },
  { properties: { a: { type: 'integer' }, b: { type: 'string' } }, additionalProperties: false },
  { properties: { a: { type: 'integer' } }, additionalProperties: { type: 'string' } },
  { prefixItems: [{ type: 'integer' }, { type: 'string' }], items: false }, { items: { type: 'array', items: { const: 1 } } },
  { allOf: [{ type: 'object' }, { required: ['a'] }] }, { anyOf: [{ type: 'string' }, { minimum: 1 }] },
  { oneOf: [{ type: 'number' }, { type: 'integer' }] }, { not: { type: 'object' } },
  { if: { type: 'string' }, then: { minLength: 2 }, else: { type: 'number' } }, { if: { required: ['a'] }, then: false },
  { type: 'object', properties: Object.fromEntries('abcdefghijk'.split('').map((c) => [c, { type: 'number' }])), additionalProperties: false },
  true, false, {},
];
corpus.forEach((s, i) => groups.push([`corpus ${i}`, s, VALUES]));

let compiled = 0, declined = 0, compared = 0, bad = 0;
for (const [label, schema, datas] of groups) {
  let normalized;
  try { normalized = new Validator(JSON.parse(JSON.stringify(schema)))._schemaObj; } catch { continue; }
  let interp;
  try { interp = createInterpreter(normalized, {}); } catch { continue; }
  const out = compileVerdict(normalized, {});
  if (out === null) { declined++; continue; }
  compiled++;
  for (const data of datas) {
    let want;
    try { want = interp.validate(data).valid; } catch { continue; }
    let got;
    try { got = out.fn(data); } catch (e) { got = 'threw ' + e.message; }
    compared++;
    if (got !== want && bad++ < 10) console.error(`${label}: plan-source says ${got}, interpreter ${want} on ${String(JSON.stringify(data))}`);
  }
}

assert.strictEqual(bad, 0, `${bad} disagreements between plan-source and the interpreter`);
assert.ok(compiled > 400 && compared > 3000, `compiled ${compiled} schemas and compared ${compared} results, too few to mean much`);
console.log(`ok: plan-source agrees with the interpreter on ${compared} results over ${compiled} schemas (${declined} declined)`);

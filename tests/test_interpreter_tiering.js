'use strict';

// The interpreted engine answers a schema's first calls with its plain walk
// and compiles the closure tree once the schema has been used often (TIER in
// lib/interpreter-core.js). Both must answer alike, and the switch must not
// show: these pin the walk to the closure tree on the official suite, the two
// places the walk was found to differ once it answered real calls (custom
// keywords on a node that is not a leaf, data deep enough to overflow its
// stack), and the shared error runtime's answer to such data.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createInterpreter } = require('../lib/interpreter');
const { Validator } = require('..');

const plain = (r) => JSON.stringify({ valid: r.valid, errors: r.errors });

// The suite, three dialects: the walk (tier never reached) against the closure
// tree (tier 0), verdicts and error lists.
{
  let cases = 0;
  const bad = [];
  for (const [dialect, v1] of Object.entries({ 'draft2020-12': false, draft7: false, v1: true })) {
    const dir = path.join(__dirname, 'suite/tests', dialect);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
        let walk, tree;
        try {
          walk = createInterpreter(group.schema, { v1, tier: Infinity });
          tree = createInterpreter(group.schema, { v1, tier: 0 });
        } catch { continue; }
        for (const t of group.tests) {
          cases++;
          const a = walk.validate(t.data), b = tree.validate(t.data);
          if (plain(a) !== plain(b) || walk.isValid(t.data) !== tree.isValid(t.data)) bad.push(`${dialect}/${file}: ${group.description} / ${t.description}`);
        }
      }
    }
  }
  assert.ok(cases > 2500, `too few cases: ${cases}`);
  assert.deepStrictEqual(bad, [], `the walk and the closure tree differ on ${bad.length} cases`);
  console.log(`ok: the walk and the closure tree agree on ${cases} suite cases`);
}

// The switch happens after TIER calls, and the answers do not change across it.
{
  const it = createInterpreter({ type: 'object', properties: { a: { type: 'string' } } }, { tier: 5 });
  for (let i = 0; i < 5; i++) assert.strictEqual(it.isValid({ a: 'x' }), true);
  assert.strictEqual(it._fast, undefined, 'still on the walk after TIER calls');
  assert.strictEqual(it.isValid({ a: 1 }), false);
  assert.notStrictEqual(it._fast, undefined, 'compiled after TIER calls');
  assert.strictEqual(plain(it.validate({ a: 1 })), plain(createInterpreter({ type: 'object', properties: { a: { type: 'string' } } }, { tier: Infinity }).validate({ a: 1 })));
  console.log('ok: the closure tree takes over after TIER calls');
}

// A custom keyword on a node with subschemas: the walk ran custom keywords
// only on leaves, and accepted what this one rejects.
{
  const keywords = { maxKeys: { type: 'object', compile: (n) => (d) => Object.keys(d).length <= n } };
  const schema = { type: 'object', properties: { p: { type: 'string' } }, maxKeys: 2 };
  const walk = new Validator(schema, { keywords, engine: 'interpreter' });
  const code = new Validator(schema, { keywords });
  for (const d of [{ a: 1, b: 2, c: 3 }, { a: 1 }, { p: 1, a: 1, b: 1 }]) {
    assert.strictEqual(walk.validate(d).valid, code.validate(d).valid, JSON.stringify(d));
    assert.strictEqual(walk.isValidObject(d), code.isValidObject(d), JSON.stringify(d));
  }
  assert.strictEqual(walk.validate({ a: 1, b: 2, c: 3 }).valid, false);
  console.log('ok: a custom keyword on a node with subschemas is checked by the walk');
}

// Data deeper than the walk's stack: the interpreter answers through the
// closure tree, as it did before calls were tiered; the shared error runtime,
// which has no closure tree, reports no detail instead of throwing.
{
  const schema = { $defs: { A: { type: 'object', properties: { n: { type: 'integer' }, c: { $ref: '#/$defs/A' } } } }, $ref: '#/$defs/A' };
  let deep = { n: 'x' };
  for (let i = 0; i < 20000; i++) deep = { n: i, c: deep };
  const it = createInterpreter(schema, {});
  let verdict;
  try { verdict = it.isValid(deep); } catch (e) { verdict = e; }
  const tree = createInterpreter(schema, { tier: 0 });
  let want;
  try { want = tree.isValid(deep); } catch (e) { want = e; }
  assert.strictEqual(typeof verdict === 'boolean' ? verdict : 'threw', typeof want === 'boolean' ? want : 'threw', 'deep data answers as the closure tree does');
  const { createErrors } = require('../error-runtime');
  assert.strictEqual(createErrors(schema)(deep), null, 'the error runtime reports no detail on data it cannot walk');
  console.log('ok: data deeper than the walk answers through the closure tree, and the error runtime does not throw');
}

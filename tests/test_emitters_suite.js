'use strict';

// Every case of the official suite through every standalone emitter, against
// new Validator(schema). bundleStandalone and bundleCompact missed a helper
// their length checks call (`_cpLen`) from 1.10.0 to 1.54.0 and threw on the
// first such string, because no test ran the suite through them. Each suite
// file is also bundled as one module of all its schemas, so two schemas
// sharing a module cannot collide on a name.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Validator } = require('..');
const aot = require('../lib/aot.js');

let blocked = false;
try { new Function('return 1')(); } catch { blocked = true; }
if (blocked) { console.log('skip: code generation is blocked, standalone modules cannot be loaded here'); process.exit(0); }

const load = (src) => { const m = { exports: {} }; new Function('module', 'exports', 'require', src)(m, m.exports, require); return m.exports; };
const root = path.join(__dirname, 'suite/tests');
const URIS = { 'draft2020-12': null, 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#' };
const counts = {};
const bad = [];
const check = (k, got, want, where) => {
  counts[k] = (counts[k] || 0) + 1;
  if (got !== want) bad.push(`${k} ${where}: got ${got}, want ${want}`);
};
for (const [dialect, uri] of Object.entries(URIS)) {
  const dir = path.join(root, dialect);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const groups = [];
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      const schema = uri && g.schema !== null && typeof g.schema === 'object' && !('$schema' in g.schema) ? { ...g.schema, $schema: uri } : g.schema;
      let v;
      try { v = new Validator(schema); } catch { continue; }
      groups.push({ g, schema, v });
      let mod;
      try { mod = aot.toStandaloneModule(v, { format: 'cjs' }); } catch { mod = null; }
      const m = mod ? load(mod) : null;
      for (const t of g.tests) {
        const want = v.validate(t.data).valid;
        const where = `${dialect}/${f} | ${g.description} | ${t.description}`;
        if (m) {
          let a, b;
          try { a = m.validate(t.data).valid; } catch (e) { a = 'threw ' + e.message; }
          try { b = m.isValid(t.data); } catch (e) { b = 'threw ' + e.message; }
          check('toStandaloneModule', a, want, where);
          check('toStandaloneModule isValid', b, want, where);
        }
      }
    }
    // One bundle per file, every schema in it.
    for (const kind of ['bundleStandalone', 'bundleCompact']) {
      let fns;
      try { fns = load(Validator[kind](groups.map((x) => x.schema), { format: 'cjs' })); } catch { continue; }
      groups.forEach(({ g, v }, i) => {
        if (typeof fns[i] !== 'function') return;
        for (const t of g.tests) {
          let got;
          try { got = fns[i](t.data).valid; } catch (e) { got = 'threw ' + e.message; }
          check(kind, got, v.validate(t.data).valid, `${dialect}/${f} | ${g.description} | ${t.description}`);
        }
      });
    }
  }
}
// The format checks, asserted: each needs its own helper in the module
// (`_uri`, `_em`, the IPv6 walk), the same class of miss as `_cpLen`.
{
  const dir = path.join(root, 'draft2020-12/optional/format');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const groups = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map((g) => ({ g, v: new Validator(g.schema, { assertFormat: true }) }));
    const builds = {
      'format toStandaloneModule': () => groups.map(({ v }) => { const src = aot.toStandaloneModule(v, { format: 'cjs' }); if (!src) return null; const m = load(src); return (d) => m.validate(d); }),
      'format bundleStandalone': () => load(Validator.bundleStandalone(groups.map(({ g }) => g.schema), { format: 'cjs', assertFormat: true })),
      'format bundleCompact': () => load(Validator.bundleCompact(groups.map(({ g }) => g.schema), { format: 'cjs', assertFormat: true })),
    };
    for (const [k, build] of Object.entries(builds)) {
      const fns = build();
      groups.forEach(({ g, v }, i) => {
        if (typeof fns[i] !== 'function') return;
        for (const t of g.tests) {
          let got;
          try { got = fns[i](t.data).valid; } catch (e) { got = 'threw ' + e.message; }
          check(k, got, v.validate(t.data).valid, `format/${f} | ${g.description} | ${t.description}`);
        }
      });
    }
  }
}
assert.strictEqual(bad.length, 0, `${bad.length} differences, first:\n${bad.slice(0, 8).join('\n')}`);
for (const k of ['toStandaloneModule', 'bundleStandalone', 'bundleCompact']) assert.ok(counts[k] > 3000, `${k} covered only ${counts[k]} cases`);
for (const k of ['format toStandaloneModule', 'format bundleStandalone', 'format bundleCompact']) assert.ok(counts[k] > 700, `${k} covered only ${counts[k]} cases`);
console.log(`ok: the suite through every standalone emitter matches the runtime Validator (${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')})`);

'use strict';
// ata-validator/ir and ata-validator/kernels give a pattern the engine the
// Validator gives it. The reference is the Validator's own choice: for a
// check, the code generator's (useSafeEngine in lib/pattern-choice.js: the
// platform RegExp where it is shown to run the pattern in linear time or the
// pattern has a property escape, the linear engine where that represents it,
// the RegExp otherwise); for the removeAdditional pass, the interpreter's
// (compilePattern in lib/interpreter-core.js), which the Validator's pass
// uses.
//
// Part one: for each place a pattern is compiled (the closures of
// compileClosures, the written modules, table modules, the removal pass), a
// pattern the Validator gives the linear engine answers in linear time on a
// long input, and right. The writers that cannot carry the
// engine (closure modules, plans sent as data) refuse it.
//
// Part two: every distinct pattern of the JSON Schema Test Suite, and of
// SchemaStore's schemas where a checkout is found (ATA_SCHEMASTORE, or
// ../schemastore beside the repository), takes the same engine in every form
// as in the Validator and gives the same answers on a set of probes. A
// pattern the ir refuses (not valid with the u flag) is counted apart and
// never counts as agreement.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Validator } = require('../index.js');
const jsc = require('../lib/js-compiler.js')._internal;
const interp = require('../lib/interpreter.js');

const ROOT = path.join(__dirname, '..');
const KERNELS_URL = pathToFileURL(path.join(ROOT, 'lib', 'kernels', 'index.mjs')).href;
const BOUND = 200; // ms
const LONG = 'a'.repeat(28) + '!';
const NESTED = '^(a+)+$';

let dir = null;
let seq = 0;
// A module's text, written to a file and imported, with the kernels by file
// URL, as the bundler plugin's verifier does.
async function load (src) {
  if (dir === null) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-irpat-'));
  const file = path.join(dir, 'm' + (++seq) + '.mjs');
  fs.writeFileSync(file, src.replace(/(['"])ata-validator\/kernels\1/g, () => JSON.stringify(KERNELS_URL)));
  return import(pathToFileURL(file).href);
}
function timed (what, fn, expect) {
  const t = process.hrtime.bigint();
  const got = fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < BOUND, `${what}: ${ms.toFixed(0)} ms, over ${BOUND} ms`);
  assert.deepStrictEqual(got, expect, `${what}: answered ${JSON.stringify(got)}`);
}

(async () => {
  const ir = await import('../lib/ir/index.mjs');
  const { compilePattern, matcherFor, useSafeEngine } = await import('../lib/ir/pattern-deps.mjs');
  const { fromPlan } = await import('../lib/kernels/plan-rich.mjs');

  // ---- part one: each site, a pattern for the linear engine and a long input ----
  const leaf = { type: 'string', pattern: NESTED };
  const pats = { type: 'object', patternProperties: { [NESTED]: { type: 'number' } } };
  const closed = { type: 'object', properties: { x: true }, patternProperties: { [NESTED]: true, '^y': true }, additionalProperties: false };
  const addl = { type: 'object', properties: { x: true }, patternProperties: { [NESTED]: true }, additionalProperties: { type: 'number' } };
  const names = { type: 'object', propertyNames: { pattern: NESTED } };
  const key = { [LONG]: 'v' };
  const cases = [
    ['pattern', leaf, LONG, false],
    ['patternProperties', pats, key, true],
    ['additionalProperties false', closed, key, false],
    ['additionalProperties schema', addl, key, false],
    ['propertyNames', names, key, false],
  ];
  let checked = 0;
  for (const [what, schema, doc, valid] of cases) {
    // compileClosures: the front end's pattern matcher (kernel), and the
    // run backend's `re` and `known`.
    for (const richErrors of [true, false]) {
      const c = ir.compileClosures(schema, { richErrors });
      timed(`compileClosures ${what} isValid`, () => c.isValid(doc), valid);
      timed(`compileClosures ${what} validate`, () => c.validate(doc).valid, valid);
      // The written module: emit.mjs's pattern constant, `re` and `known`.
      for (const verdict of [true, false]) {
        const src = ir.specialize(schema, { richErrors, verdict });
        assert.ok(src.includes('compileSafe('), `specialize ${what}: no linear engine in\n${src}`);
        assert.ok(!src.includes(`new RegExp(${JSON.stringify(NESTED)}`), `specialize ${what}: the pattern is a RegExp`);
        const m = await load(src);
        timed(`module ${what} isValid`, () => m.isValid(doc), valid);
        timed(`module ${what} validate`, () => m.validate(doc).valid, valid);
      }
      // A table module: the leaf's t[3] and the pattern lists' slots, filled
      // by the writer.
      const tab = ir.tableModule(schema, { richErrors });
      assert.ok(tab !== null, `tableModule ${what} refused`);
      assert.ok(tab.includes('compileSafe('), `tableModule ${what}: no linear engine`);
      const t = await load(tab);
      timed(`table ${what} isValid`, () => t.isValid(doc), valid);
      timed(`table ${what} validate`, () => t.validate(doc).valid, valid);
      // A plan sent as data cannot carry the engine: refused.
      assert.strictEqual(ir.tablePlan(schema, { richErrors }), null, `tablePlan ${what} took a pattern for the linear engine`);
      checked++;
    }
  }
  // The closure modules compile on the RegExp: a pattern for the linear
  // engine is refused, a linear one is taken and answers.
  assert.strictEqual(ir.closureModule(leaf, { richErrors: false }), null, 'closureModule took a pattern for the linear engine');
  {
    const src = ir.closureModule({ type: 'string', pattern: '^[a-z]+$' }, { richErrors: false });
    assert.ok(src !== null, 'closureModule refused a linear pattern');
    const m = await load(src);
    assert.strictEqual(m.isValid('abc'), true); assert.strictEqual(m.isValid('ab1'), false);
    const p = ir.tablePlan({ type: 'string', pattern: '^[a-z]+$' });
    assert.ok(p !== null, 'tablePlan refused a linear pattern');
    const v = await fromPlan(p);
    assert.strictEqual(v.isValid('abc'), true); assert.strictEqual(v.isValid('ab1'), false);
  }
  // The removeAdditional pass: a long name is tested against the pattern
  // by the interpreter's choice (the linear engine here).
  for (const schema of [closed, { type: 'object', patternProperties: { [NESTED]: true }, additionalProperties: false }]) {
    const c = ir.compileClosures(schema, { removeAdditional: true });
    const doc = { [LONG]: 1, aaa: 2 };
    timed('removeAdditional', () => (c.validate(doc), Object.keys(doc).sort()), ['aaa']);
  }
  // Property escapes stay on the RegExp, as in the Validator (SECURITY.md).
  assert.ok(matcherFor('^\\p{L}+$') instanceof RegExp);
  console.log(`  ok: ${cases.length} shapes, ${checked} rich/plain runs of each form, under ${BOUND} ms`);

  // ---- part two: every pattern of the corpora ----
  const found = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n === null || typeof n !== 'object') return;
    if (typeof n.pattern === 'string') found.add(n.pattern);
    if (n.patternProperties && typeof n.patternProperties === 'object' && !Array.isArray(n.patternProperties)) for (const k of Object.keys(n.patternProperties)) found.add(k);
    for (const k of Object.keys(n)) walk(n[k]);
  };
  const readTree = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) readTree(f);
      else if (e.name.endsWith('.json')) { try { walk(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch {} }
    }
  };
  const suite = path.join(ROOT, 'tests', 'suite', 'tests');
  assert.ok(fs.existsSync(suite), 'the JSON Schema Test Suite is not checked out (tests/suite)');
  readTree(suite);
  const fromSuite = found.size;
  const store = process.env.ATA_SCHEMASTORE || path.join(ROOT, '..', 'schemastore');
  const storeDir = path.join(store, 'src', 'schemas', 'json');
  const withStore = fs.existsSync(storeDir);
  if (withStore) readTree(storeDir);

  // Probes: the pattern's own literal characters, and strings that reach
  // the usual edges (empty, digits, case, spaces, a newline, astral code
  // points, a separator).
  const BASE = ['', 'a', 'A', 'aaa', '0', '123', 'a1', 'A-Z', 'x y', 'abc-123', 'a_b.c', '\n', 'é', '🐲', 'foo@bar.com', 'http://x.io/a', '2024-01-01', '-1.5', '$', ' '];
  const probes = (p) => {
    const lits = p.replace(/\\./g, '').replace(/[\^$()[\]{}|*+?.]/g, '');
    return [...BASE, lits, lits.slice(0, 3), lits + '!', lits.repeat(2)];
  };
  const kindOf = (m) => m instanceof RegExp ? 'RegExp' : m && m.__ataSafe === true ? 'safe' : 'other';
  let n = 0; let refused = 0; let answers = 0; let safe = 0;
  for (const p of found) {
    let uValid = true;
    try { new RegExp(p, 'u'); } catch { uValid = false; }
    if (!uValid) { refused++; continue; }
    const wantSafe = jsc.useSafeEngine(p);
    if (wantSafe) safe++;
    // The decision itself, against the Validator's functions.
    assert.strictEqual(useSafeEngine(p), wantSafe, `the ir's useSafeEngine differs on ${JSON.stringify(p)}`);
    assert.strictEqual(kindOf(matcherFor(p)), wantSafe ? 'safe' : 'RegExp', `matcherFor on ${JSON.stringify(p)}`);
    assert.strictEqual(kindOf(compilePattern(p)), kindOf(interp._compilePattern(p)), `compilePattern copy differs on ${JSON.stringify(p)}`);
    const L = { type: 'string', pattern: p };
    const Q = { type: 'object', patternProperties: { [p]: true }, additionalProperties: false };
    const R = { type: 'object', patternProperties: { [p]: false } };
    const forms = [];
    for (const s of [L, Q, R]) {
      const c = ir.compileClosures(s);
      const src = ir.specialize(s, { verdict: true });
      // A pattern written inline as character checks (compilePatternInline)
      // is linear and names no engine.
      assert.strictEqual(src.includes('compileSafe('), wantSafe, `specialize on ${JSON.stringify(p)} chose ${wantSafe ? 'the RegExp' : 'the linear engine'}`);
      const tab = ir.tableModule(s);
      assert.ok(tab !== null, `tableModule refused ${JSON.stringify(p)}`);
      assert.strictEqual(tab.includes('compileSafe('), wantSafe, `tableModule on ${JSON.stringify(p)}`);
      if (s === L) assert.strictEqual(ir.closureModule(s, { richErrors: false }) === null, wantSafe, `closureModule on ${JSON.stringify(p)}`);
      forms.push([s, new Validator(s), c, src, tab]);
    }
    for (const [s, v, c, src, tab] of forms) {
      const m = await load(src); const t = await load(tab);
      for (const x of probes(p)) {
        const doc = s === L ? x : { [x]: 1 };
        const want = v.validate(doc).valid;
        const got = [c.isValid(doc), c.validate(doc).valid, m.isValid(doc), m.validate(doc).valid, t.isValid(doc), t.validate(doc).valid];
        assert.ok(got.every((g) => g === want), `${JSON.stringify(s)} on ${JSON.stringify(doc)}: Validator ${want}, ir ${JSON.stringify(got)}`);
        answers++;
      }
    }
    n++;
  }
  assert.ok(n > 0);
  console.log(`  ok: ${n} patterns (${fromSuite} from the suite${withStore ? `, ${found.size - fromSuite} more from SchemaStore` : ', SchemaStore not found'}), ${safe} on the linear engine, ${answers} probe answers equal in three forms; ${refused} not valid with the u flag, refused by the ir`);
  if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });

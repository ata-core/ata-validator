'use strict';

// Validator#_extendVerdict lets a wrapper add a check the schema does not carry,
// and for a generated verdict function the check is compiled into the function
// in place of its final `return true`. The danger is the opposite of the usual
// one: a check that is skipped is a silent accept of whatever the wrapper was
// there to reject. Any top-level `return true` in the generated code is
// rewritten into the check, by the same rewrite the hybrid relies on. No shape
// the generator emits today returns true before the end, so that rewrite is a
// guard for the day one does.
//
// So the relation tested is exact, over every schema and case of the official
// suite plus the format cases: the check runs if and only if the schema itself
// accepts the value. Counting the calls, rather than only comparing verdicts,
// is what would catch an early return that skipped it.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Validator } = require('..');

const REMOTES_DIR = path.join(__dirname, 'suite/remotes');
const registry = {};
(function collect (dir, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, prefix + entry.name + '/');
    else if (entry.name.endsWith('.json')) {
      try { registry['http://localhost:1234/' + prefix + entry.name] = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {}
    }
  }
})(REMOTES_DIR, '');

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
};

const files = [];
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect);
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) files.push({ file: path.join(dir, f), uri, formats: false });
  const fmt = path.join(dir, 'optional/format');
  if (fs.existsSync(fmt)) for (const f of fs.readdirSync(fmt)) if (f.endsWith('.json')) files.push({ file: path.join(fmt, f), uri, formats: true });
}
assert.ok(files.length > 50, `found only ${files.length} suite files; is the submodule checked out?`);

const clone = (x) => JSON.parse(JSON.stringify(x));
const withDialect = (schema, uri) =>
  (typeof schema === 'object' && schema !== null && !Array.isArray(schema) && !('$schema' in schema))
    ? { ...schema, $schema: uri } : schema;

let cases = 0, fused = 0, bad = 0;
for (const { file, uri, formats } of files) {
  for (const group of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const opts = () => formats ? { schemas: registry } : { schemas: registry, assertFormat: false, useDefaults: false };
    let plain, calls = 0, never, always, counted, vNever, vAlways;
    const EXTRA = { keyword: 'extra', instancePath: '', schemaPath: '#/extra', params: {}, message: 'extra check failed' };
    try {
      plain = new Validator(withDialect(clone(group.schema), uri), opts());
      counted = new Validator(withDialect(clone(group.schema), uri), opts());
      counted._extendVerdict(() => () => { calls++; return true; });
      never = new Validator(withDialect(clone(group.schema), uri), opts());
      never._extendVerdict(() => () => false);
      always = new Validator(withDialect(clone(group.schema), uri), opts());
      always._extendVerdict(() => () => true);
      vNever = new Validator(withDialect(clone(group.schema), uri), opts());
      vNever._extendValidate(() => ({ check: () => false, errors: () => [EXTRA] }));
      vAlways = new Validator(withDialect(clone(group.schema), uri), opts());
      vAlways._extendValidate(() => ({ check: () => true, errors: () => null }));
    } catch { continue; }
    for (const t of group.tests) {
      let expect;
      try { expect = plain.isValidObject(clone(t.data)); } catch { continue; }
      cases++;
      calls = 0;
      const got = counted.isValidObject(clone(t.data));
      const fail = (why) => { if (bad++ < 10) console.error(`${path.basename(file)} / ${group.description} / ${t.description}: ${why}`); };
      if (got !== expect) fail(`extended verdict ${got}, plain ${expect}`);
      if (expect && calls !== 1) fail(`schema accepts but the check ran ${calls} times`);
      if (!expect && calls !== 0) fail(`schema rejects but the check ran ${calls} times`);
      if (never.isValidObject(clone(t.data)) !== false) fail('a check that always fails was skipped');
      if (always.isValidObject(clone(t.data)) !== expect) fail('a check that always passes changed the verdict');

      // validate(): same relation, and the schema's own errors come first and unchanged.
      let pr;
      try { pr = plain.validate(clone(t.data)); } catch { continue; }
      const key = (es) => JSON.stringify(es.map((e) => [e.keyword, e.instancePath, e.schemaPath]));
      const ra = vAlways.validate(clone(t.data));
      if (ra.valid !== pr.valid) fail(`validate with a passing check said ${ra.valid}, plain ${pr.valid}`);
      else if (!pr.valid && key(ra.errors) !== key(pr.errors)) fail('a passing check changed the errors');
      const rn = vNever.validate(clone(t.data));
      if (rn.valid !== false) fail('validate skipped a check that always fails');
      else {
        const want = pr.valid ? [] : pr.errors;
        const got = rn.errors;
        if (key(got.slice(0, want.length)) !== key(want)) fail('the schema errors changed or moved behind the check');
        if (got.length !== want.length + 1 || got[got.length - 1].keyword !== 'extra') fail(`expected the check's error last, got ${key(got)}`);
      }
    }
    if (counted._jsFn && typeof counted._jsFn._withTail === 'function') fused++;
  }
}
assert.strictEqual(bad, 0, `${bad} disagreements; the check is being skipped or run on rejected values`);
// Most of the suite compiles to generated code, so most of these groups went
// through the fused function rather than the composed fallback. If that stops
// being true the relation above is being tested on the wrong path.
assert.ok(cases > 3000, `only ${cases} cases compared`);
assert.ok(fused > 450, `only ${fused} schema groups used the fused function`);

// Rebinding. The validator replaces isValidObject as it compiles further, and
// the check has to survive each replacement.
{
  const schema = () => ({ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] });
  const tail = () => (d) => d.n !== 13;

  // Extended before any call, then validate() forces the full compile.
  const a = new Validator(schema())._extendVerdict(tail);
  assert.strictEqual(a.isValidObject({ n: 13 }), false);
  a.validate({ n: 1 });
  a.validate({ n: 'x' }).errors;
  assert.strictEqual(a.isValidObject({ n: 13 }), false, 'check lost after the full compile');
  assert.strictEqual(a.isValidObject({ n: 1 }), true);

  // Extended after the verdict method was already bound.
  const b = new Validator(schema());
  assert.strictEqual(b.isValidObject({ n: 13 }), true);
  b._extendVerdict(tail);
  assert.strictEqual(b.isValidObject({ n: 13 }), false, 'check not applied to a method bound before it');
  for (let i = 0; i < 5; i++) b.isValidObject({ n: i });
  assert.strictEqual(b.isValidObject({ n: 13 }), false, 'check lost when tier 0 moved to generated code');

  // With coercion the rewrite has to run before the check sees the value.
  const c = new Validator({ type: 'object', properties: { n: { type: 'number' } } }, { coerceTypes: true })
    ._extendVerdict(() => (d) => typeof d.n === 'number');
  assert.strictEqual(c.isValidObject({ n: '5' }), true, 'check ran before coercion');

  // A validator with nothing to add stays as it was.
  const d = new Validator(schema())._extendVerdict(() => null);
  assert.strictEqual(d.isValidObject({ n: 13 }), true);

  // Two extensions both apply.
  const e = new Validator(schema())._extendVerdict(tail)._extendVerdict(() => (x) => x.n !== 7);
  assert.strictEqual(e.isValidObject({ n: 13 }), false);
  assert.strictEqual(e.isValidObject({ n: 7 }), false);
  assert.strictEqual(e.isValidObject({ n: 1 }), true);

  // Only the verdict method takes the check: validate() is the wrapper's to report.
  assert.strictEqual(new Validator(schema())._extendVerdict(tail).validate({ n: 13 }).valid, true);
}

// validate() on the paths the lazy layer does not cover, where the extension
// wraps the finished method instead.
{
  const ERR = { keyword: 'thirteen', instancePath: '/n', schemaPath: '#', params: {}, message: 'not 13' };
  const ext = () => ({ check: (d) => d.n !== 13, errors: (d) => (d.n === 13 ? [ERR] : null) });
  const schema = () => ({ type: 'object', properties: { n: { type: 'number' }, s: { type: 'string' } }, required: ['n'] });
  for (const [label, opts] of [['default', undefined], ['coerceTypes', { coerceTypes: true }], ['abortEarly', { abortEarly: true }], ['useDefaults', { useDefaults: true }]]) {
    const v = new Validator(schema(), opts)._extendValidate(ext);
    assert.strictEqual(v.validate({ n: 1 }).valid, true, `${label}: valid value`);
    const only = v.validate({ n: 13 });
    assert.strictEqual(only.valid, false, `${label}: the check alone rejects`);
    assert.deepStrictEqual(only.errors.map((e) => e.keyword), ['thirteen'], `${label}: only the check's error`);
    const both = v.validate({ n: 13, s: {} });
    assert.strictEqual(both.valid, false);
    const kws = both.errors.map((e) => e.keyword);
    assert.strictEqual(kws[kws.length - 1], 'thirteen', `${label}: the check's error comes last`);
    if (label !== 'abortEarly') assert.ok(kws.includes('type'), `${label}: the schema's error is kept`);
    assert.strictEqual(JSON.parse(JSON.stringify(both)).valid, false, `${label}: serializes`);
    const raw = both._ataRaw();
    assert.strictEqual(raw[raw.length - 1].keyword, 'thirteen', `${label}: raw list carries the check's error`);
    assert.strictEqual(v.validateAndParse('{"n":13}').valid, false, `${label}: validateAndParse goes through it`);
    assert.strictEqual(v['~standard'].validate({ n: 13 }).issues.length > 0, true, `${label}: Standard Schema sees it`);
  }

  // The JSON entry points take the same check, and keep it when the scanner
  // stubs rebind themselves, which they do once a caller has used them often
  // enough. 200 calls is past that point.
  for (const [label, opts] of [['default', undefined], ['coerceTypes', { coerceTypes: true }], ['abortEarly', { abortEarly: true }]]) {
    const v = new Validator(schema(), opts)._extendValidate(ext);
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(v.isValidJSON('{"n":13}'), false, `${label}: isValidJSON call ${i} skipped the check`);
      assert.strictEqual(v.isValidJSON('{"n":1}'), true, `${label}: isValidJSON call ${i} rejected a valid value`);
      const r = v.validateJSON('{"n":13}');
      assert.strictEqual(r.valid, false, `${label}: validateJSON call ${i} skipped the check`);
      assert.strictEqual(r.errors[r.errors.length - 1].keyword, 'thirteen', `${label}: validateJSON call ${i} lost the check's error`);
      assert.strictEqual(v.validateJSON('{"n":1}').valid, true, `${label}: validateJSON call ${i} rejected a valid value`);
      assert.strictEqual(v.validateJSON(Buffer.from('{"n":13}')).valid, false, `${label}: validateJSON on a Buffer skipped the check`);
      const p = v.validateAndParse('{"n":13}');
      assert.strictEqual(p.valid, false, `${label}: validateAndParse call ${i} skipped the check`);
      assert.deepStrictEqual(p.value, { n: 13 });
    }
    // Text the schema itself rejects keeps the schema's answer.
    assert.strictEqual(v.isValidJSON('{"n":"x"}'), false);
    assert.strictEqual(v.validateJSON('{"n":"x"}').valid, false);
  }

  // A check that fails with no errors to give still rejects, everywhere.
  {
    const mute = () => ({ check: () => false, errors: () => null });
    const v = new Validator(schema())._extendValidate(mute);
    const r = v.validate({ n: 1 });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.length > 0, 'a rejection always carries an error');
    assert.strictEqual(v.validateJSON('{"n":1}').valid, false);
    assert.strictEqual(v.validateAndParse('{"n":1}').valid, false);
    assert.strictEqual(v.isValidJSON('{"n":1}'), false);
    const w = new Validator(schema(), { coerceTypes: true })._extendValidate(mute);
    const rw = w.validate({ n: 1 });
    assert.strictEqual(rw.valid, false);
    assert.ok(rw.errors.length > 0, 'the wrapped path also carries an error');
  }

  // Too late is an error, not a silent no-op.
  const late = new Validator(schema());
  late.validate({ n: 1 });
  assert.throws(() => late._extendValidate(ext), /before the validator compiles/);

  // An extended validator is not what `new Validator(sameSchema)` returns.
  const shared = schema();
  const x = new Validator(shared)._extendValidate(ext)._extendVerdict(() => (d) => d.n !== 13);
  x.validate({ n: 1 });
  const y = new Validator(shared);
  assert.notStrictEqual(y, x, 'the extended instance leaked through the identity cache');
  assert.strictEqual(y.validate({ n: 13 }).valid, true);
  assert.strictEqual(y.isValidObject({ n: 13 }), true);
}

console.log(`ok: extended verdict and validate agree with the schema on ${cases} suite cases, ${fused} groups fused`);

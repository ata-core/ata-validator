'use strict';

// minLength and maxLength count code points, and a surrogate that is not part
// of a pair counts as one. The interpreted engine's counter skipped the unit
// after every high surrogate without asking whether it was a low one, so
// '\ud800b' counted as one code point and passed maxLength: 1 (1.65.0 and
// before). That engine answers with code generation blocked, for
// engine: 'interpreter', and for a small schema's first verdicts once a process
// has met sixteen schemas (the small twin), so validateJSON, and through the
// twin isValidObject and validate(), accepted it with eval allowed too. The
// oracle here is [...s].length, which is the spec's count.
//
// Every string is checked at count - 1, count and count + 1 on both bounds (a
// short one at every bound), through validate, isValidObject, validateJSON and
// isValidJSON, on four validator configurations, ata-validator/lite,
// index.edge.js and standalone modules. Each child process runs one setting:
// code generation blocked, the small twin answering, and the twin turned off
// (ATA_NO_SMALL_TWIN=1) with and without the native engine.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CHILD = process.argv[2] === '--child';

const strings = [
  '\ud800b', '\ud800', '\udc00\ud800', 'a\u{1F642}\ud83d', '\u{1F642}', '\u{10FFFF}', '\ud800\ud800',
  'b\ud800', '\udc00', '􏿿', '\udbff', '퟿\udc00',
  // Long and mixed, past the bounds the counters decide on length alone.
  ('a\u{1F642}\ud800').repeat(30),
  ('\ud800b').repeat(40),
  ('\u{1F642}').repeat(70),
  'x'.repeat(50) + '\ud83d'.repeat(20) + '\u{1F642}'.repeat(20),
  ('\udc00\ud800').repeat(33) + 'z',
  ('\u{1F642}a🙂\udc00').repeat(15),
];

const cases = [];
for (const s of strings) {
  const c = [...s].length;
  // A short string is checked at every bound up to past its length, which
  // walks each place the counters stop early.
  const ks = s.length <= 12 ? Array.from({ length: s.length + 3 }, (_, k) => k) : [c - 1, c, c + 1];
  for (const k of ks) {
    if (k < 0) continue;
    cases.push({ s, schema: { type: 'string', minLength: k }, want: c >= k });
    cases.push({ s, schema: { type: 'string', maxLength: k }, want: c <= k });
    cases.push({ s, schema: { type: 'string', minLength: k, maxLength: k }, want: c === k });
    cases.push({ s, schema: { type: 'object', properties: { p: { type: 'string', maxLength: k } } }, data: { p: s }, want: c <= k });
    cases.push({ s, schema: { type: 'object', properties: { p: { type: 'string', minLength: k } } }, data: { p: s }, want: c >= k });
    // A property name is counted the same way (propertyNames).
    cases.push({ s, schema: { type: 'object', propertyNames: { maxLength: k } }, data: { [s]: 1 }, want: c <= k });
    cases.push({ s, schema: { type: 'object', propertyNames: { minLength: k } }, data: { [s]: 1 }, want: c >= k });
    cases.push({ s, schema: { type: 'object', propertyNames: { minLength: k, maxLength: k + 1 }, properties: { z: {} } }, data: { [s]: 1 }, want: c >= k && c <= k + 1 });
  }
  // A bound that is not a whole number is compared as written.
  if (s.length <= 12) {
    for (const k of [0.5, 1.5, 2.5]) {
      cases.push({ s, schema: { type: 'string', minLength: k }, want: c >= k });
      cases.push({ s, schema: { type: 'string', maxLength: k }, want: c <= k });
      cases.push({ s, schema: { type: 'object', propertyNames: { minLength: k } }, data: { [s]: 1 }, want: c >= k });
    }
  }
}

// The JSON text as JSON.stringify writes it (lone surrogates escaped) and, where
// the string needs no escape, with the units written raw.
function texts(d) {
  const out = [JSON.stringify(d)];
  const raw = out[0].replace(/\\u(d[89a-f][0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (raw !== out[0]) out.push(raw);
  return out;
}

let checked = 0;
function check(label, got, c) {
  assert.strictEqual(got, c.want, `${label}: ${JSON.stringify(c.schema)} on ${JSON.stringify(c.s)} (${[...c.s].length} code points)`);
  checked++;
}

function runValidator(name, Validator, opts) {
  for (const c of cases) {
    const d = c.data !== undefined ? c.data : c.s;
    // Twice each: the first calls and the compiled ones may be different engines.
    for (let r = 0; r < 2; r++) {
      const v = new Validator(c.schema, opts);
      check(`${name} validate`, v.validate(d).valid, c);
      check(`${name} isValidObject`, v.isValidObject(d), c);
      for (const t of texts(d)) {
        check(`${name} validateJSON`, v.validateJSON(t).valid, c);
        check(`${name} isValidJSON`, v.isValidJSON(t), c);
      }
      check(`${name} validate again`, v.validate(d).valid, c);
    }
  }
}

function runAll() {
  const configs = [['default', undefined], ['interpreter', { engine: 'interpreter' }], ['richErrors:false', { richErrors: false }], ['abortEarly', { abortEarly: true }]];
  const entries = [['index.js', require(path.join(ROOT, 'index.js'))], ['lite.js', require(path.join(ROOT, 'lite.js'))], ['index.edge.js', require(path.join(ROOT, 'index.edge.js'))]];
  for (const [entry, mod] of entries) for (const [cfg, opts] of configs) runValidator(`${entry} ${cfg}`, mod.Validator, opts);
}

// The three code generators, called directly as the runtime calls them.
function runEntryPoints() {
  const jc = require(path.join(ROOT, 'lib/js-compiler.js'));
  const VALID = { valid: true, errors: [] };
  for (const c of cases) {
    const d = c.data !== undefined ? c.data : c.s;
    const cg = jc.compileToJSCodegen(c.schema, null);
    const er = jc.compileToJSCodegenWithErrors(c.schema, null);
    const co = jc.compileToJSCombined(c.schema, VALID, null);
    assert.ok(cg && er && co, `the generators compile ${JSON.stringify(c.schema)}`);
    check('compileToJSCodegen', !!cg(d), c);
    check('compileToJSCodegenWithErrors', er(d, true).valid, c);
    check('compileToJSCombined', co(d).valid, c);
  }
}

function runModules() {
  const { toStandaloneModule } = require(path.join(ROOT, 'build.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-cp-'));
  try {
    let i = 0;
    const seen = new Map();
    for (const c of cases) {
      const key = JSON.stringify(c.schema);
      let m = seen.get(key);
      if (m === undefined) {
        const src = toStandaloneModule(c.schema, { format: 'cjs' });
        assert.ok(typeof src === 'string', `a module is emitted for ${key}`);
        const file = path.join(dir, `m${i++}.cjs`);
        fs.writeFileSync(file, src);
        m = require(file);
        seen.set(key, m);
      }
      const d = c.data !== undefined ? c.data : c.s;
      check('module validate', m.validate(d).valid, c);
      check('module isValid', m.isValid(d), c);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The small twin: once a process has met sixteen schemas, a new small schema's
// first verdicts come from the interpreted engine before it compiles. Each
// schema here is made unique so none is in the compile cache, which the twin
// declines.
function runTwin() {
  const { Validator } = require(path.join(ROOT, 'index.js'));
  for (let i = 0; i < 32; i++) new Validator({ type: 'integer', minimum: i }).isValidObject(i);
  let twins = 0;
  let u = 0;
  for (const c of cases) {
    const d = c.data !== undefined ? c.data : c.s;
    const a = new Validator(Object.assign({ $comment: 'twin ' + u++ }, c.schema));
    check('twin isValidObject', a.isValidObject(d), c);
    if (a._twin) twins++;
    const b = new Validator(Object.assign({ $comment: 'twin ' + u++ }, c.schema));
    check('twin validate', b.validate(d).valid, c);
  }
  assert.ok(twins > cases.length / 2, `the twin answered (${twins} of ${cases.length})`);
}

const MODE = process.argv[3];
if (CHILD) {
  if (MODE === 'blocked') {
    // Code generation is blocked by the flag; prove it before trusting the run.
    assert.throws(() => new Function('return 1'), EvalError);
    runAll();
  } else if (MODE === 'twin') {
    runTwin();
  } else {
    runAll();
  }
  console.log(`ok child ${MODE}: ${checked} answers`);
} else {
  runEntryPoints();
  runModules();
  const children = [
    ['blocked', ['--disallow-code-generation-from-strings'], { ATA_NO_NATIVE: '1' }],
    ['twin', [], {}],
    ['notwin', [], { ATA_NO_SMALL_TWIN: '1' }],
    ['notwin-js', [], { ATA_NO_SMALL_TWIN: '1', ATA_NO_NATIVE: '1' }],
  ];
  for (const [mode, flags, env] of children) {
    // tests/run.js sets ATA_NO_SMALL_TWIN=1 for every file; each child gets the
    // setting its mode names.
    const childEnv = Object.assign({}, process.env, env);
    if (env.ATA_NO_SMALL_TWIN === undefined) delete childEnv.ATA_NO_SMALL_TWIN;
    const r = spawnSync(process.execPath, [...flags, __filename, '--child', mode], { encoding: 'utf8', env: childEnv });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    assert.strictEqual(r.status, 0, `the ${mode} child agrees with the oracle`);
  }
  console.log(`ok: code point counts match [...s].length (${cases.length} cases, modules ${checked} answers, four children)`);
}

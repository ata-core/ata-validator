'use strict';

// The gate: every way this package answers for a schema, against one
// reference, the Validator with default options, on the same documents.
//
// ata answers through many paths: generated code, the interpreted engine, the
// modules `ata build` writes in several forms, the error runtime they share,
// and the backends of ata-validator/ir. A fix made in one of them and not in
// another is the bug this project has had most often, and a suite per path
// does not show it, because each suite has its own documents and its own
// idea of what to compare. Here a path is one entry in PATHS: how to build
// it, and which fields of an error it promises. Adding a path to the package
// means adding it here.
//
// What is compared, for every document: the verdict (isValid and validate),
// the errors' fields the path promises, in order where the path promises
// order, and the document afterwards (defaults filled). A path may decline a
// schema (null), which is counted and never guessed. The one difference
// allowed is the documented one: a module that cannot build error detail
// reports the single ATA9000 error.
//
//   node scripts/gate.js                     the official suite, every dialect
//   node scripts/gate.js --schemastore <dir> SchemaStore's samples as well
//   node scripts/gate.js --paths a,b         only these paths
//
// tests/test_gate_suite.js runs the first form in `npm test`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
// Generated code is what the default path is here: the twin that answers a
// schema's first calls with the interpreted engine is off, as in tests/run.js.
process.env.ATA_NO_SMALL_TWIN = '1';
const { Validator } = require(ROOT);
const aot = require(path.join(ROOT, 'lib/aot-impl'));
const build = require(path.join(ROOT, 'build'));
const { fromCompiledPlain } = require(path.join(ROOT, 'lib/compiled-plain'));
const { errorRuntimeSource, runtimeFeatures } = require(path.join(ROOT, 'lib/error-runtime'));
const { stripAnnotationsKeepingDefaults } = require(path.join(ROOT, 'lib/schema-strip'));
const ATA_VERSION = require(path.join(ROOT, 'lib/version'));

const RICH = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'expected', 'received', 'detail', 'suggestion', 'related', 'rank', 'docUrl'];
const MODULE = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'docUrl'];
const PLAIN = ['keyword', 'instancePath', 'schemaPath', 'params', 'message'];
const pick = (fields) => function f(e) { return fields.map((k) => e[k]).concat([Array.isArray(e.branchErrors) ? e.branchErrors.map(f) : null]); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-gate-'));
let seq = 0;
const loadCjs = (src) => { const m = new Module('gate'); m._compile(src, path.join(tmp, 'm.cjs')); return m.exports; };
// A module that imports a runtime file: both written to a directory of their own.
function loadWithRuntime(src, runtimeName, runtimeSrc) {
  const d = path.join(tmp, String(seq++)); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, runtimeName), runtimeSrc);
  const f = path.join(d, 'm.cjs'); fs.writeFileSync(f, src);
  const m = require(f);
  for (const k of Object.keys(require.cache)) if (k.startsWith(d)) delete require.cache[k];
  return m;
}

// The ES modules of ata-validator/ir, loaded once (main awaits this).
let ir = null; let K = null; let plans = null; let functionBody = null;
async function loadIr() {
  ir = await import(path.join(ROOT, 'lib/ir/index.mjs'));
  K = await import(path.join(ROOT, 'lib/kernels/index.mjs'));
  plans = await import(path.join(ROOT, 'lib/kernels/plan-rich.mjs'));
  ({ functionBody } = await import(path.join(ROOT, 'lib/ir/emit.mjs')));
}
const irModule = (src) => new Function('K', functionBody(src))(K);
const irData = (src) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(src); return new Function('K', `const {${m[1]}}=K\n` + src.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + 'return{isValid,validate}')(K); };
const irRefused = (e) => e && typeof e.message === 'string' && e.message.startsWith('ir:');

// A path: build(schema) returns { validate, isValid } or null when it declines
// the schema. `fields` are the error fields it promises; `ref` the Validator
// options its answers are those of; `ordered: false` where it promises the
// errors and not their order; `abort` where ATA9000 may stand for the list;
// `json` where it answers JSON text. `fills`: it fills defaults itself; a
// module does not (its caller asks it to), so its reference does not either.
const PATHS = {
  'interpreted engine': { fields: RICH, fills: true, build: (s) => { const v = new Validator(s, { engine: 'interpreter' }); return { validate: (d) => v.validate(d), isValid: (d) => v.isValidObject(d) }; } },
  'generated code, warm': { fields: RICH, fills: true, build: (s) => { const v = new Validator(s); for (let i = 0; i < 80; i++) v.isValidObject(i % 2 ? {} : []); return { validate: (d) => v.validate(d), isValid: (d) => v.isValidObject(d) }; } },
  'closure tree': { fields: RICH, fills: true, build: (s) => { const v = new Validator(s, { engine: 'interpreter' }); for (let i = 0; i < 1100; i++) v.isValidObject(i % 2 ? {} : []); return { validate: (d) => v.validate(d), isValid: (d) => v.isValidObject(d) }; } },
  'JSON text': { fields: RICH, json: true, fills: false, build: (s) => { const v = new Validator(s); return { validate: (d) => v.validateJSON(JSON.stringify(d)), isValid: (d) => v.isValidJSON(JSON.stringify(d)) }; } },
  'plain errors': { fields: PLAIN, ref: { richErrors: false }, fills: true, build: (s) => { const v = new Validator(s, { richErrors: false, engine: 'interpreter' }); return { validate: (d) => v.validate(d), isValid: (d) => v.isValidObject(d) }; } },
  'module': { fields: MODULE, abort: true, ref: { useDefaults: false }, build: (s) => { const src = aot.toStandaloneModule(new Validator(s), { format: 'cjs', order: true, onWarning() {} }); return src ? loadCjs(src) : null; } },
  'module, one pass': { fields: MODULE, abort: true, ref: { useDefaults: false }, ordered: false, build: (s) => { const src = aot.toStandaloneModule(new Validator(s), { format: 'cjs', onePass: true, onWarning() {} }); return src ? loadCjs(src) : null; } },
  'module, plain errors': { fields: PLAIN, ref: { richErrors: false }, fills: true, build: (s) => {
    if (!build.compiledEligible(s)) return null;
    const src = build.compiledModuleFor(s, { format: 'cjs', plainErrors: true });
    if (!src) return null;
    const v = fromCompiledPlain(loadCjs(src), build.compiledSchemaFor(s), { richErrors: false });
    return { validate: (d) => v.validate(d), isValid: (d) => v.isValidObject(d) };
  } },
  'compact module': { fields: MODULE, abort: true, ref: { useDefaults: false }, build: (s) => {
    const v = new Validator(s); const src = aot.toCompactModule(v, { format: 'cjs', errorRuntime: './ata-errors.cjs' });
    return src ? loadWithRuntime(src, 'ata-errors.cjs', errorRuntimeSource('cjs', ATA_VERSION, runtimeFeatures([stripAnnotationsKeepingDefaults(v._schemaObj)]), false)) : null;
  } },
  'schema module': { fields: MODULE, abort: true, ref: { useDefaults: false }, build: (s) => {
    const v = new Validator(s); const src = aot.toSchemaModule(v, { format: 'cjs', runtime: './ata-errors.cjs' });
    return src ? loadWithRuntime(src, 'ata-errors.cjs', errorRuntimeSource('cjs', ATA_VERSION, runtimeFeatures([stripAnnotationsKeepingDefaults(v._schemaObj)]), true)) : null;
  } },
  'ir module': { fields: RICH, fills: true, build: (s) => { try { return irModule(ir.specialize(s, { verdict: true })); } catch (e) { if (irRefused(e)) return null; throw e; } } },
  'ir module, plain errors': { fields: PLAIN, ref: { richErrors: false }, fills: true, build: (s) => { try { return irModule(ir.specialize(s, { verdict: true, richErrors: false })); } catch (e) { if (irRefused(e)) return null; throw e; } } },
  'ir closures': { fields: RICH, fills: true, build: (s) => { try { return ir.compileClosures(s, {}); } catch (e) { if (irRefused(e)) return null; throw e; } } },
  'ir table': { fields: RICH, fills: true, build: (s) => { const t = ir.tableModule(s, {}); return t === null ? null : irData(t); } },
  'ir table, plain errors': { fields: PLAIN, ref: { richErrors: false }, fills: true, build: (s) => { const t = ir.tableModule(s, { richErrors: false }); return t === null ? null : irData(t); } },
  'ir plan as JSON': { fields: RICH, fills: true, async: true, build: async (s) => { const p = ir.tablePlan(s, {}); return p === null ? null : plans.fromPlan(JSON.parse(JSON.stringify(p))); } },
  'ir closure module': { fields: PLAIN, ref: { richErrors: false }, build: (s) => { const t = ir.closureModule(s, { richErrors: false }); return t === null ? null : irData(t); } },
};

// Differences that are known and written down where they are made. They are
// counted and shown apart, and do not fail the gate; removing an entry here
// is how one of them gets fixed.
const KNOWN = {
  // Generated code tests a `properties` node for an array only where a
  // property is named `length` or like an index (lib/js-compiler.js, the
  // properties block: the test on every node cost a reject path 18% in its
  // first calls). An array given another own name, which JSON text cannot
  // produce, is then read as an object by generated code and by no other
  // path, and rejected with ATA9001.
  'array with a named key': 'generated code reads an array with an own named key as an object',
};

// Schemas whose errors come in a different order from generated code than
// from the interpreted walk (same errors, same verdict). Open, not decided.
const KNOWN_ORDER = [
  // A $ref to an embedded resource that holds a $dynamicRef: the errors name
  // paths in two resources, and neither engine has a rank for them.
  'unevaluatedItems with $dynamicRef',
];

const clone = (d) => (d === undefined ? d : structuredClone(d));
const jsonable = (d) => { try { return JSON.stringify(d) !== undefined && JSON.stringify(JSON.parse(JSON.stringify(d))) === JSON.stringify(d); } catch { return false; } };

// Documents no sample holds: arrays where objects are expected (defaults
// must stay off them), values JSON cannot hold, a name on the prototype.
function extraDocs(schema) {
  const out = [[[], 'empty array'], [[{}], 'array'], [[[1], { x: 1 }], 'array'], [{}, 'empty object'], [null, 'primitive'], [0, 'primitive'], ['x', 'primitive'], [true, 'primitive']];
  if (schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object') {
    const ks = Object.keys(schema.properties);
    if (ks.length) {
      out.push([Object.create({ [ks[0]]: 1 }), 'inherited name'], [{ [ks[0]]: undefined }, 'undefined value'], [Object.defineProperty({}, ks[0], { value: [], enumerable: false }), 'hidden name'], [Object.assign([1], { [ks[0]]: {} }), 'array with a named key']);
    }
  }
  return out;
}

// Runs every path on one schema. Returns nothing; counts in `stats` and
// pushes what differs to `report`.
// `every`: one schema in that many is checked (the unit suite's share of the run).
let EVERY = 1; let SEEN = 0;
async function check(label, schema, docs, stats, report, only) {
  if (EVERY > 1 && SEEN++ % EVERY !== 0) return;
  const refs = new Map();
  const refFor = (opts) => { const k = JSON.stringify(opts || {}); if (!refs.has(k)) { try { refs.set(k, new Validator(schema, opts)); } catch { refs.set(k, null); } } return refs.get(k); };
  if (refFor() === null) return;
  try { refFor().isValidObject(null); } catch { return; }
  stats.schemas++;
  const all = docs.map((d) => [d, 'sample']).concat(extraDocs(schema));
  for (const [name, P] of Object.entries(PATHS)) {
    if (only && !only.has(name)) continue;
    const st = stats.paths[name] || (stats.paths[name] = { taken: 0, declined: 0, docs: 0, diffs: 0, threw: 0, abort: 0 });
    let p;
    try { p = P.async ? await P.build(schema) : P.build(schema); } catch (e) { st.threw++; if (report.length < 40) report.push(`${name} | ${label} | building threw: ${String(e && e.message).slice(0, 160)}`); continue; }
    if (p === null) { st.declined++; continue; }
    const ref = refFor(P.ref);
    if (ref === null) { st.declined++; continue; }
    st.taken++;
    const shape = pick(P.fields);
    for (const [d, tag] of all) {
      // JSON text carries what JSON can: not undefined, a hidden or inherited name, or an array's named key.
      if (P.json && (tag !== 'sample' && tag !== 'array' && tag !== 'empty array' && tag !== 'empty object' && tag !== 'primitive' || !jsonable(d))) continue;
      st.docs++;
      const a = clone(d); const b = clone(d);
      let want; let got; let ok;
      try { want = ref.validate(a); } catch { continue; }
      try { got = p.validate(b); ok = p.isValid(clone(d)); } catch (e) { st.threw++; st.diffs++; if (report.length < 40) report.push(`${name} | ${label} | threw on ${show(d)}: ${String(e && e.message).slice(0, 160)}`); continue; }
      const fail = (what) => { if (KNOWN[tag] !== undefined || (what.startsWith('errors') && KNOWN_ORDER.some((x) => label.endsWith(x)))) { st.known = (st.known || 0) + 1; return; } st.diffs++; const k = `${name} | ${what.split(/[:\n]/)[0]} | ${tag}`; stats.kinds[k] = (stats.kinds[k] || 0) + 1; if (!stats.first[k]) stats.first[k] = `${label} | ${what} | ${show(d)}`; };
      if (got.valid !== want.valid || ok !== want.valid) { fail(`verdict: Validator ${want.valid}, validate ${got.valid}, isValid ${ok}`); continue; }
      if (!want.valid) {
        if (P.abort && got.errors.length === 1 && got.errors[0].code === 'ATA9000') st.abort++;
        else {
          let x = want.errors.map(shape).map((e) => JSON.stringify(e)); let y = got.errors.map(shape).map((e) => JSON.stringify(e));
          if (P.ordered === false) { x = x.slice().sort(); y = y.slice().sort(); }
          if (x.join('\n') !== y.join('\n')) { fail(`errors\n      Validator ${x.join(' ').slice(0, 300)}\n      path      ${y.join(' ').slice(0, 300)}`); continue; }
        }
      }
      if (P.fills && JSON.stringify(a) !== JSON.stringify(b)) fail(`the document afterwards: Validator ${show(a)}, path ${show(b)}`);
    }
  }
}
const show = (d) => { let t; try { t = JSON.stringify(d); } catch { t = undefined; } return (t === undefined ? String(d) : t).slice(0, 100) + (d && typeof d === 'object' ? ' keys ' + JSON.stringify(Object.keys(d)).slice(0, 40) : ''); };

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#', v1: 'https://json-schema.org/v1' };
async function suite(stats, report, only) {
  const S = path.join(ROOT, 'tests/suite/tests');
  // The dialects this package reads (draft3 and draft-next are in the suite and are not among them).
  for (const dialect of ['draft2020-12', 'draft2019-09', 'draft7', 'draft6', 'draft4', 'v1']) {
    if (!fs.existsSync(path.join(S, dialect))) continue;
    for (const sub of ['', 'optional/format']) {
      const dir = path.join(S, dialect, sub);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
          if (JSON.stringify(g.schema).includes('localhost:1234')) continue;
          // The dialect is said, as tests/run_suite.js says it: a group's schema rarely declares its own.
          const schema = g.schema !== null && typeof g.schema === 'object' && !Array.isArray(g.schema) && !('$schema' in g.schema) ? { $schema: DIALECTS[dialect], ...g.schema } : g.schema;
          await check(`${dialect}/${sub ? sub + '/' : ''}${f}: ${g.description}`, schema, g.tests.map((t) => t.data), stats, report, only);
        }
      }
    }
  }
}

// SchemaStore: each schema's sample documents and copies of them changed in
// one place, from a generator read at its high bits (its low bits repeat).
async function schemastore(root, stats, report, only) {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n; };
  const BAD = ['', ' ', 'not a uri', 'x y', '2026-13-45', '::::', 'a..b', '-x-', '9'.repeat(40)];
  const mutate = (doc) => {
    const c = structuredClone(doc); const slots = [];
    const walk = (n, depth) => { if (depth > 7 || n === null || typeof n !== 'object') return; for (const k of Object.keys(n)) { slots.push([n, k]); walk(n[k], depth + 1); } };
    walk(c, 0);
    if (slots.length === 0) return 12345;
    const [o, k] = slots[rnd(slots.length)]; const r = rnd(9);
    if (r === 0) o[k] = 12345; else if (r === 1) o[k] = 'zz'; else if (r === 2) o[k] = null; else if (r === 3) o[k] = [1, 'a']; else if (r === 4) o[k] = { bogus: 1 };
    else if (r === 5) { if (Array.isArray(o)) o.splice(+k, 1); else delete o[k]; } else if (r === 6) { if (!Array.isArray(o)) o['zzUnknown' + rnd(9)] = true; } else if (r === 7 && typeof o[k] === 'string') o[k] = BAD[rnd(BAD.length)]; else o[k] = o[k] === true ? false : true;
    return c;
  };
  const dir = path.join(root, 'src/schemas/json');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const name = f.slice(0, -5);
    let schema; try { schema = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const docs = [];
    for (const t of ['src/test', 'src/negative_test']) {
      const td = path.join(root, t, name);
      if (!fs.existsSync(td)) continue;
      for (const x of fs.readdirSync(td).filter((x) => x.endsWith('.json'))) { try { docs.push(JSON.parse(fs.readFileSync(path.join(td, x), 'utf8'))); } catch {} }
    }
    if (docs.length === 0) continue;
    const muts = []; for (const d of docs) for (let i = 0; i < 3; i++) muts.push(mutate(d));
    await check('schemastore/' + name, schema, docs.concat(muts), stats, report, only);
  }
}

async function run(opts) {
  await loadIr();
  const stats = { schemas: 0, paths: {}, kinds: {}, first: {} }; const report = [];
  const only = opts.paths ? new Set(opts.paths) : null;
  EVERY = opts.every > 1 ? opts.every : 1; SEEN = 0;
  if (opts.suite !== false) await suite(stats, report, only);
  if (opts.schemastore) await schemastore(opts.schemastore, stats, report, only);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { stats, report };
}

function summary({ stats, report }) {
  const lines = [`${stats.schemas} schemas, ${Object.keys(stats.paths).length} paths against the Validator`];
  for (const [name, s] of Object.entries(stats.paths)) lines.push(`  ${name.padEnd(26)} ${String(s.taken).padStart(5)} schemas (${s.declined} declined) ${String(s.docs).padStart(7)} documents  ${s.diffs} differ${s.threw ? `, ${s.threw} threw` : ''}${s.abort ? `, ${s.abort} as ATA9000` : ''}${s.known ? `, ${s.known} known` : ''}`);
  for (const r of report) lines.push('  ' + r);
  // What differs, by path, kind and the kind of document, with the first of each.
  for (const [k, n] of Object.entries(stats.kinds).sort((a, b) => b[1] - a[1])) lines.push(`  ${String(n).padStart(5)}  ${k}\n         ${stats.first[k].slice(0, 700)}`);
  return lines.join('\n');
}

module.exports = { run, summary, PATHS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; };
  run({ schemastore: arg('--schemastore'), paths: arg('--paths') ? arg('--paths').split(',') : undefined, suite: !argv.includes('--no-suite'), every: Number(arg('--every')) || 1 }).then((r) => {
    console.log(summary(r));
    const bad = Object.values(r.stats.paths).reduce((n, s) => n + s.diffs + s.threw, 0);
    process.exit(bad === 0 ? 0 : 1);
  }, (e) => { console.error(e); process.exit(2); });
}

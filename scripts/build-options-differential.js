'use strict';

// The options a build writes into a module of ata-validator/ir
// (lib/compiled-common.js BUILD_OPTIONS: formats as calls to the caller's
// functions, schemas resolved at build time, assertFormat), held against the
// runtime given the same options, on the same documents: the verdict
// (isValid and validate), the plain error fields in order, the rich ones
// the modules promise, and the document afterwards. Two runtimes are the
// reference, the root Validator and the 2.0 browser entry's.
//
// Each format a schema names is given a stand-in function that answers
// unlike every built-in check (by the string's length), on both sides, so a
// hole the module skipped, or bound to the built-in check of the same name,
// shows as a difference. A schema the build declines (an `ir:` error, a
// reference that resolves to nothing) is counted, never guessed.
//
// One difference is known and counted apart (runtimeFormatOff), on the table
// writer only: under assertFormat: false the runtime still asserts a format
// that a reference reaches under a name that is not a keyword (SchemaStore's
// travis, `#/definitions/notificationObject/webhooks`), which is the
// runtime's bug: no format is asserted with that option. The table writer
// asserts none. Remove the exclusion when the runtime is fixed.
//
// Two writers are held, each with its own counts: the module writer
// (specialize) and the table writer (tableModule), which takes formats as
// holes too, declines `schemas`, and returns null for what it does not cover.
//
//   node scripts/build-options-differential.js                  the official suite with its remotes
//   node scripts/build-options-differential.js --schemastore <dir>   SchemaStore's samples as well
//   node scripts/build-options-differential.js --every N [--offset k]   one schema group in N (SchemaStore in
//                                                                       shards: a process holds every module it loads)
//
// tests/test_ir_build_options.js runs a share of the suite in `npm test`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
process.env.ATA_NO_SMALL_TWIN = '1';
const { Validator } = require(ROOT);

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  'draft2019-09': 'https://json-schema.org/draft/2019-09/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  draft6: 'http://json-schema.org/draft-06/schema#',
  draft4: 'http://json-schema.org/draft-04/schema#',
  v1: null,
};

const KERNELS = pathToFileURL(path.join(ROOT, 'lib/kernels/index.mjs')).href;
// A directory per run, removed at its end.
let tmp = null;
let seq = 0;
async function load(src) {
  const f = path.join(tmp, `m${seq++}.mjs`);
  fs.writeFileSync(f, src.replace(/(['"])ata-validator\/kernels\1/g, () => JSON.stringify(KERNELS)));
  return import(pathToFileURL(f).href);
}

// The format names a schema (or a registered document) writes.
function formatNames(v, out = new Set()) {
  if (Array.isArray(v)) { for (const x of v) formatNames(x, out); return out; }
  if (v === null || typeof v !== 'object') return out;
  for (const k of Object.keys(v)) {
    if (k === 'format' && typeof v[k] === 'string') out.add(v[k]);
    if (k === 'enum' || k === 'const' || k === 'examples' || k === 'default') continue;
    formatNames(v[k], out);
  }
  return out;
}
// A stand-in per name, by the string's length and the name's, which no
// built-in check of any format answers the same way on every string.
const standIn = (name) => (v) => (v.length + name.length) % 3 !== 0;
const standIns = (names) => Object.fromEntries([...names].filter((n) => n !== '__proto__').map((n) => [n, standIn(n)]));

const PLAIN = ['keyword', 'instancePath', 'schemaPath', 'params', 'message'];
const RICH = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message'];
const pick = (fields) => (e) => fields.map((k) => e[k]);
const show = (r) => JSON.stringify(r);

async function check(name, schema, docs, optionSets, stats, report, refs) {
  for (const [label, opts] of optionSets) {
    const key = `${name} [${label}]`;
    let rtPlain, rtRich;
    // Each runtime from its own copy of the schema: validators of one schema
    // object share its registered documents (lib/schema-order.js), and two
    // registries of equal documents built apart read as a conflict there,
    // which drops the error order behind a reference into them.
    const own = () => structuredClone(schema);
    try { rtPlain = new Validator(own(), { ...opts, richErrors: false }); rtRich = new Validator(own(), opts); rtRich.validate({}); }
    catch { stats.runtimeRefuses++; continue; }
    let v2Plain = null;
    try { v2Plain = new refs.V2(own(), { ...opts, richErrors: false }); v2Plain.validate({}); } catch { v2Plain = null; }
    const irOpts = { ...opts, holes: true, strictRefs: true };
    for (const backend of ['module', 'table']) {
      const S = stats[backend];
      let plainSrc, richSrc;
      if (backend === 'module') {
        try {
          plainSrc = refs.specialize(schema, { ...irOpts, verdict: true, richErrors: false });
          richSrc = refs.specialize(schema, { ...irOpts, verdict: true });
        } catch (e) {
          if (!/^ir/.test(e.message)) throw new Error(`${key}: specialize threw outside the IR's own refusals: ${e.message}`);
          S.declined++;
          S.declines[e.message.slice(0, 60)] = (S.declines[e.message.slice(0, 60)] || 0) + 1;
          continue;
        }
      } else {
        plainSrc = refs.tableModule(schema, { ...irOpts, richErrors: false });
        richSrc = refs.tableModule(schema, irOpts);
        if ((plainSrc === null) !== (richSrc === null)) throw new Error(`${key}: the table writer took one error shape and declined the other`);
        if (plainSrc === null) { S.declined++; continue; }
      }
      if (refs.mutate) {
        const out = refs.mutate(plainSrc, backend);
        if (out === plainSrc) continue;
        plainSrc = out; richSrc = refs.mutate(richSrc, backend);
      }
      const mp = await load(plainSrc); const mr = await load(richSrc);
      for (const m of [mp, mr]) if (typeof m.setFormats === 'function') m.setFormats(opts.formats || {});
      if (opts.formats && Object.keys(opts.formats).length && typeof mp.setFormats === 'function') S.withHoles++;
      S.compiled++;
      for (const doc of docs) {
        S.docs++;
        const text = JSON.stringify(doc);
        if (text === undefined) continue;
        const fresh = () => JSON.parse(text);
        const runtimeAnswer = (V, R) => { const d1 = fresh(); const r = V.validate(d1); const d2 = fresh(); return { valid: V.isValidObject(d2), r: { valid: r.valid, errors: r.valid ? [] : r.errors.map(pick(PLAIN)) }, after: JSON.stringify(d1), rich: R ? (() => { const d3 = fresh(); const x = R.validate(d3); return x.valid ? [] : x.errors.map(pick(RICH)); })() : null }; };
        const moduleAnswer = () => { const d1 = fresh(); const r = mp.validate(d1); const d2 = fresh(); const x = mr.validate(fresh()); return { valid: mp.isValid(d2), r: { valid: r.valid, errors: r.valid ? [] : r.errors.map(pick(PLAIN)) }, after: JSON.stringify(d1), rich: x.valid ? [] : x.errors.map(pick(RICH)) }; };
        let a, b, c = null;
        try { a = runtimeAnswer(rtPlain, rtRich); } catch { S.runtimeThrows++; continue; }
        try { b = moduleAnswer(); } catch (e) { b = { threw: e.message }; }
        if (v2Plain) { try { c = runtimeAnswer(v2Plain, null); } catch { c = null; } }
        // The verdict and the document afterwards: no difference is allowed,
        // from either runtime, unless the two runtimes give different verdicts
        // themselves. The errors: none from the root Validator where the 2.0
        // entry gives the same list; where the two runtimes list them
        // differently (their order in a registered document) it is counted
        // apart, as the runtimes' own disagreement.
        const verdictSame = (x, y) => !x.threw && !y.threw && x.valid === y.valid && x.valid === x.r.valid && y.valid === y.r.valid && x.after === y.after;
        const errorsSame = (x, y, rich) => show(x.r) === show(y.r) && (!rich || show(x.rich) === show(y.rich));
        const note = (counter, keys) => {
          S[counter]++; S[keys][key] = (S[keys][key] || 0) + 1;
          if (process.env.DIFFS_OUT) fs.appendFileSync(process.env.DIFFS_OUT, JSON.stringify({ kind: counter, backend, key, doc: text, runtime: a, module: b, v2: c }) + '\n');
          if (report.length < 40) report.push({ kind: counter, backend, key, doc: text.slice(0, 300), runtime: a, module: b, v2: c });
        };
        // The known runtime bug, and nothing wider: assertFormat is false,
        // the runtime reports a format error, and the plan answers exactly
        // as the runtime does with its format errors taken out (the verdict,
        // every other error in order, plain and rich, and the document).
        if (backend === 'table' && opts.assertFormat === false && !b.threw && !a.valid && a.r.errors.some((e) => e[0] === 'format')) {
          const rest = a.r.errors.filter((e) => e[0] !== 'format'); const richRest = a.rich.filter((e) => e[1] !== 'format');
          if (b.valid === (rest.length === 0) && b.r.valid === b.valid && show(b.r.errors) === show(rest) && show(b.rich) === show(richRest) && a.after === b.after) { note('runtimeFormatOff', 'runtimeFormatOffKeys'); continue; }
        }
        const runtimesSplitVerdict = c !== null && !verdictSame(a, c);
        const runtimesSplitErrors = c !== null && (runtimesSplitVerdict || !errorsSame(a, c, false));
        if (runtimesSplitVerdict || runtimesSplitErrors) { S.runtimesDisagree++; S.disagreeKeys[key] = (S.disagreeKeys[key] || 0) + 1; }
        if (!verdictSame(a, b)) { if (runtimesSplitVerdict && verdictSame(c, b)) note('splitVerdict', 'splitKeys'); else note('diffs', 'diffKeys'); }
        else if (c !== null && !verdictSame(c, b) && !runtimesSplitVerdict) note('v2Diffs', 'v2DiffKeys');
        else if (!errorsSame(a, b, true)) { if (runtimesSplitErrors) note('splitErrors', 'splitKeys'); else note('diffs', 'diffKeys'); }
      }
    }
  }
}

// The option sets each schema is held under: the formats it names as
// functions, assertFormat: false, and those beside `schemas` where the
// schema reaches registered documents.
function optionSetsFor(schema, registry) {
  const names = formatNames(schema);
  if (registry) for (const d of Object.values(registry)) formatNames(d, names);
  const sets = [];
  const reg = registry ? { schemas: registry } : {};
  if (registry) sets.push(['schemas', reg]);
  if (names.size) {
    sets.push(['formats', { ...reg, formats: standIns(names) }]);
    sets.push(['formats, assertFormat: false', { ...reg, formats: standIns(names), assertFormat: false }]);
  }
  sets.push(['assertFormat: false', { ...reg, assertFormat: false }]);
  return sets;
}

function suiteRegistry() {
  const registry = {};
  (function collect(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) collect(full, prefix + e.name + '/');
      else if (e.name.endsWith('.json')) { try { registry['http://localhost:1234/' + prefix + e.name] = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {} }
    }
  })(path.join(ROOT, 'tests/suite/remotes'), '');
  return registry;
}

async function suite(stats, report, refs, every) {
  const S = path.join(ROOT, 'tests/suite/tests');
  const registry = suiteRegistry();
  let n = 0;
  for (const dialect of Object.keys(DIALECTS)) {
    for (const sub of ['', 'optional', 'optional/format']) {
      const dir = path.join(S, dialect, sub);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
          if (n++ % every !== 0) continue;
          const schema = DIALECTS[dialect] && g.schema !== null && typeof g.schema === 'object' && !Array.isArray(g.schema) && !('$schema' in g.schema) ? { $schema: DIALECTS[dialect], ...g.schema } : g.schema;
          const remote = JSON.stringify(g.schema).includes('localhost:1234');
          stats.schemas++;
          await check(`${dialect}/${sub ? sub + '/' : ''}${f}: ${g.description}`, schema, g.tests.map((t) => t.data), optionSetsFor(schema, remote ? registry : null), stats, report, refs);
        }
      }
    }
  }
}

// SchemaStore: each schema's sample documents and copies of them changed in
// one place, as scripts/gate.js changes them, a string often to one no
// format accepts.
async function schemastore(root, stats, report, refs, every, offset) {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n; };
  const BAD = ['', ' ', 'not a uri', 'x y', '2026-13-45', '::::', 'a..b', '-x-', '9'.repeat(40), 'ab', 'abc'];
  const mutate = (doc) => {
    const c = structuredClone(doc); const slots = [];
    const walk = (n, depth) => { if (depth > 7 || n === null || typeof n !== 'object') return; for (const k of Object.keys(n)) { slots.push([n, k]); walk(n[k], depth + 1); } };
    walk(c, 0);
    if (slots.length === 0) return 12345;
    const [o, k] = slots[rnd(slots.length)];
    o[k] = typeof o[k] === 'string' || rnd(2) ? BAD[rnd(BAD.length)] : 12345;
    return c;
  };
  const dir = path.join(root, 'src/schemas/json');
  let n = 0;
  // A schema that names files beside it: those files registered under the
  // URIs its references resolve to from its own $id, followed from file to
  // file, so `schemas` is held on real relative references.
  const siblings = (d, schema) => {
    const base = typeof schema.$id === 'string' && /^https?:/.test(schema.$id) ? schema.$id : 'https://json.schemastore.org/' ;
    const reg = {}; const queue = [[schema, base]]; let any = false;
    while (queue.length) {
      const [doc, at] = queue.pop();
      for (const m of JSON.stringify(doc).matchAll(/"\$ref":"([^"#][^"]*)"/g)) {
        let url; try { url = new URL(m[1], at); } catch { continue; }
        const file = path.basename(url.pathname);
        const key = url.href.replace(/#.*$/, '');
        if (reg[key] !== undefined || !/\.json$/.test(file) || !fs.existsSync(path.join(d, file))) continue;
        try { reg[key] = JSON.parse(fs.readFileSync(path.join(d, file), 'utf8')); any = true; } catch { continue; }
        queue.push([reg[key], key]);
      }
    }
    // A web of documents past this size (schema-org-thing names hundreds)
    // makes modules the process cannot hold by the hundred; counted, not run.
    if (any && JSON.stringify(reg).length > 400000) { stats.registryTooLarge++; return null; }
    return any ? reg : null;
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const name = f.slice(0, -5);
    let schema; try { schema = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const docs = [];
    for (const t of ['src/test', 'src/negative_test']) {
      const td = path.join(root, t, name);
      if (!fs.existsSync(td)) continue;
      for (const x of fs.readdirSync(td).filter((x) => x.endsWith('.json'))) { try { docs.push(JSON.parse(fs.readFileSync(path.join(td, x), 'utf8'))); } catch {} }
    }
    if (docs.length === 0 || (!JSON.stringify(schema).includes('"format"') && !/"\$ref":"[^"#]/.test(JSON.stringify(schema)))) continue;
    if (n++ % every !== offset) continue;
    stats.schemas++;
    if (process.env.PROGRESS) process.stderr.write(`${name} ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB\n`);
    const muts = []; for (const d of docs) for (let i = 0; i < 4; i++) muts.push(mutate(d));
    await check('schemastore/' + name, schema, docs.concat(muts), optionSetsFor(schema, siblings(dir, schema)), stats, report, refs);
  }
}

async function run({ schemastoreDir = null, every = 1, offset = 0, mutate = null, suiteOn = true } = {}) {
  const { specialize, tableModule } = await import(pathToFileURL(path.join(ROOT, 'lib/ir/index.mjs')).href);
  const { Validator: V2 } = await import(pathToFileURL(path.join(ROOT, 'index.v2.browser.mjs')).href);
  const refs = { specialize, tableModule, V2, mutate };
  // Counted per writer; what belongs to the schema or the runtime, once.
  const per = () => ({ compiled: 0, withHoles: 0, declined: 0, declines: {}, docs: 0, diffs: 0, v2Diffs: 0, splitVerdict: 0, splitErrors: 0, runtimesDisagree: 0, runtimeFormatOff: 0, runtimeFormatOffKeys: {}, diffKeys: {}, v2DiffKeys: {}, splitKeys: {}, disagreeKeys: {}, runtimeThrows: 0 });
  const stats = { schemas: 0, registryTooLarge: 0, runtimeRefuses: 0, module: per(), table: per() };
  const report = [];
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-build-options-')));
  try {
    if (suiteOn) await suite(stats, report, refs, every);
    if (schemastoreDir) await schemastore(schemastoreDir, stats, report, refs, every, offset);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { stats, report };
}

module.exports = { run };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  run({ schemastoreDir: arg('--schemastore'), every: Number(arg('--every')) || 1, offset: Number(arg('--offset')) || 0, suiteOn: !argv.includes('--no-suite') }).then(({ stats, report }) => {
    for (const r of report.slice(0, 15)) console.log(JSON.stringify(r).slice(0, 900));
    console.log(JSON.stringify(stats, null, 1));
    process.exitCode = stats.module.diffs || stats.module.v2Diffs || stats.table.diffs || stats.table.v2Diffs ? 1 : 0;
  }, (e) => { console.error(e); process.exitCode = 1; });
}

'use strict';

// Writes docs/correctness-report.md from runs, never from typed figures.
//
//   node scripts/gate-report.js --schemastore <dir>   measure and write the report
//   node scripts/gate-report.js                       the same without SchemaStore
//   node scripts/gate-report.js --record <file>       also write what was measured as JSON
//   node scripts/gate-report.js --from <file>         write the report from such a JSON, measuring nothing
//   node scripts/gate-report.js --check               the committed report against its own record
//
// What it runs: scripts/gate.js on the official suite and, given a checkout,
// on SchemaStore (each with --json, in its own process); tests/run_suite.js
// for each dialect; tests/test_no_eval.js; and the test file of each sweep
// class whose fix is in this tree. Everything measured is kept as one record,
// which the report carries at its end, so tests/test_gate_report.js can render
// it again and compare, and run the cheap parts again and compare those.
//
// The sweep classes below are data: what was found, the commits that fix it
// and the tests that hold it closed. Whether a fix is in this tree is asked of
// git when the report is written. A fix that is rebased gets its new commit
// written here.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'correctness-report.md');
const DIALECTS = ['draft2020-12', 'draft2019-09', 'draft7', 'draft6', 'draft4', 'v1'];

// Why each entry of the gate's KNOWN_ORDER is allowed. A new entry with no
// reason here stops the report.
const ORDER_REASONS = {
  'unevaluatedItems with $dynamicRef': 'A `$ref` to an embedded resource that holds a `$dynamicRef`: the errors name paths in two resources and neither engine ranks them, so generated code and the interpreted walk list the same errors in a different order. The verdict and the set of errors agree. Open, not decided.',
};
// The same for KNOWN, by kind of document. Empty in gate.js today.
const KNOWN_REASONS = {};

const EFFECT = {
  accepts: 'accepted documents it should reject',
  both: 'accepted documents it should reject and rejected documents it should accept',
  rejects: 'rejected documents it should accept',
  order: 'the answer depended on the order of the two values compared',
  threw: 'threw instead of answering',
  passes: 'filled, removed or coerced by one document while validation read another',
};

// The classes found by the 1.x sweep (the Unreleased section of CHANGELOG.md
// on the sweep branch), one per entry there.
const CLASSES = [
  { id: 'ref-unresolved-registered', title: 'A `$ref` that does not resolve, inside a document given through `schemas` and reached through another reference: generated code and the modules wrote no check for it.', effect: 'accepts', fixes: ['3429ae8', '45052bb'], tests: ['tests/test_registered_ref_resolution.js', 'tests/test_codegen_entrypoint_agreement.js'] },
  { id: 'ref-preprocess-suffix', title: 'The defaults, `removeAdditional` and `coerceTypes` passes followed a relative `$ref` into another document by path suffix.', effect: 'passes', fixes: ['bb8a738', '73d307f'], tests: ['tests/test_registered_ref_resolution.js'] },
  { id: 'ref-cycle-documents', title: 'A cycle of references across registered documents reached the verdict generator as written, and it wrote no check for the reference back.', effect: 'accepts', fixes: ['8f41bb7'], tests: ['tests/test_registered_ref_resolution.js'] },
  { id: 'ref-cycle-local', title: 'A local definition reached again through an anchor, or an anchor that refers to itself, on a cycle the generator does not detect.', effect: 'accepts', fixes: ['3953dcd'], tests: ['tests/test_registered_ref_resolution.js'] },
  { id: 'length-lone-high-surrogate', title: '`minLength` and `maxLength` in the interpreted engine counted a lone high surrogate and the unit after it as one code point.', effect: 'accepts', fixes: ['dc9bf05'], tests: ['tests/test_code_point_pairs.js'] },
  { id: 'equality-enumerable', title: '`enum`, `const` and `uniqueItems` compared two objects by the keys of one side only, for objects with a non-enumerable own property.', effect: 'order', fixes: ['333707e', '95f3e90'], tests: ['tests/test_deep_equal_enumerable.js'] },
  { id: 'ir-object-flag', title: 'A module from `ata-validator/ir` for a schema with `propertyDependencies` or draft-07 `dependencies` did not declare the object flag it reads.', effect: 'threw', fixes: ['57a1e22'], tests: ['tests/test_ir_object_flag.mjs'] },
  { id: 'property-names-length', title: '`propertyNames` with `minLength` or `maxLength` counted UTF-16 units in the three code generators, where the interpreted engine counts code points.', effect: 'both', fixes: ['05ab41e'], tests: ['tests/test_code_point_pairs.js'] },
  { id: 'closure-equality', title: 'The closure compiler compared `enum`, `const` and `uniqueItems` values by a canonical string that wrote a string inside an array without quotes.', effect: 'both', fixes: ['96849ae'], tests: ['tests/test_closure_equality.js'] },
  { id: 'ref-pointer-base', title: 'A schema reached by a JSON pointer through a name no keyword reads had its own references resolved against the root.', effect: 'accepts', fixes: ['b42396e', '7ab4de4'], tests: ['tests/test_registered_ref_resolution.js', 'tests/test_ir_registered_docs.mjs'] },
  { id: 'ir-draft7-root-ref', title: '`ata-validator/ir` registered a draft-07 document whose root is a `$ref` under no name.', effect: 'rejects', fixes: ['6cc0b8d'], tests: ['tests/test_ir_registered_docs.mjs'] },
  { id: 'ir-unreachable-defaults', title: 'A module from `ata-validator/ir` called the shared defaults pass for defaults that pass cannot reach.', effect: 'threw', fixes: ['86f4a91'], tests: ['tests/test_ir_registered_docs.mjs'] },
  { id: 'native-count-bounds', title: 'The native engine skipped a length, item or property count bound that is not a whole number from zero.', effect: 'accepts', fixes: ['d76b4a9'], tests: ['tests/test_buffer_gate.js', 'tests/test_code_point_pairs.js'] },
  { id: 'small-engine-negative-max', title: 'The small engine that answers a simple schema\'s first calls read `maxLength: -1` as no bound.', effect: 'accepts', fixes: ['8f77b65'], tests: ['tests/test_code_point_pairs.js'] },
  { id: 'buffer-preprocess', title: 'The buffer APIs answered from the native walker for a validator with defaults, `coerceTypes` or `removeAdditional`, judging the bytes before those passes.', effect: 'both', fixes: ['641f9e2', 'e114137'], tests: ['tests/test_buffer_gate.js', 'tests/test_buffer_defaults_static.js'] },
  { id: 'native-repeated-names', title: 'The native walkers read JSON text that names a member twice, or holds a surrogate escape outside a pair, differently from JSON.parse.', effect: 'both', fixes: ['56c03df', 'dbc0434'], tests: ['tests/test_native_duplicate_names.js'] },
  { id: 'cache-key-unfaithful', title: 'A schema holding a value JSON cannot carry (NaN, Infinity, a hole) shared compiled code with the schema its JSON text spells.', effect: 'accepts', fixes: ['65332c5', 'a587dbf'], tests: ['tests/test_compile_cache_unfaithful.js'] },
  { id: 'from-standalone-defaults', title: '`Validator.fromStandalone()` built its defaults pass from the root schema alone and ran it only in `validate()`.', effect: 'both', fixes: ['96e6647'], tests: ['tests/test_from_standalone_defaults.js'] },
];

// ---------------------------------------------------------------------------
// Measuring

const node = (args, env) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ATA_NO_SMALL_TWIN: '1', ...env } });
const git = (dir, args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

// scripts/gate.js in a process of its own, read back from its --json.
function runGate(args) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-gate-report-')), 'gate.json');
  const r = node([path.join(ROOT, 'scripts', 'gate.js'), ...args, '--json', f]);
  if (r.status !== 0 && r.status !== 1) throw new Error(`scripts/gate.js ${args.join(' ')} exited ${r.status}\n${r.stderr.slice(-2000)}`);
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
  g.exit = r.status;
  // Where the checkout sits on this machine is not part of the result.
  g.given.schemastore = !!g.given.schemastore;
  return g;
}

function measureSuite() {
  return DIALECTS.map((dialect) => {
    const r = node([path.join(ROOT, 'tests', 'run_suite.js'), dialect]);
    const a = /^\s*(\d+) passed of (\d+) /m.exec(r.stdout);
    const b = /^\s*(\d+) known failures, (\d+) regressions/m.exec(r.stdout);
    if (!a || !b) throw new Error(`tests/run_suite.js ${dialect}: no figures in its output\n${r.stdout.slice(-1500)}${r.stderr.slice(-1500)}`);
    return { dialect, passed: +a[1], total: +a[2], knownFailures: +b[1], regressions: +b[2], exit: r.status };
  });
}

function measureNoEval() {
  const r = node([path.join(ROOT, 'tests', 'test_no_eval.js')]);
  const dialects = DIALECTS.map((dialect) => {
    const m = new RegExp(`^\\s*(PASS|FAIL)\\s+${dialect.replace(/[.-]/g, '\\$&')}\\s+(\\d+)/(\\d+) passed, (\\d+) failed, (\\d+) errored`, 'm').exec(r.stdout);
    if (!m) throw new Error(`tests/test_no_eval.js: no figures for ${dialect}\n${r.stdout.slice(-1500)}${r.stderr.slice(-1500)}`);
    return { dialect, passed: +m[2], total: +m[3], failed: +m[4], errored: +m[5] };
  });
  const blocked = /^\s*(\d+) code generation attempts blocked/m.exec(r.stdout);
  return { dialects, blocked: blocked ? +blocked[1] : null, standardSchema: /PASS\s+~standard/.test(r.stdout), exit: r.status };
}

function corpusSuite() {
  const dir = fs.realpathSync(path.join(ROOT, 'tests', 'suite'));
  const log = git(dir, ['log', '-1', '--format=%H%n%cs%n%s']);
  if (!log) throw new Error('tests/suite is not a git checkout: run `git submodule update --init tests/suite`');
  const [commit, date, subject] = log.split('\n');
  // The commit the tree pins, which the checkout should be at.
  const ls = git(ROOT, ['ls-tree', 'HEAD', 'tests/suite']);
  const pinned = ls ? ls.split(/\s+/)[2] : null;
  return { commit, date, subject, pinned, atPin: pinned === commit };
}

function corpusSchemaStore(dir) {
  const log = git(dir, ['log', '-1', '--format=%H%n%cs%n%s']);
  if (!log) throw new Error(`${dir} is not a git checkout of SchemaStore`);
  const [commit, date, subject] = log.split('\n');
  const files = fs.readdirSync(path.join(dir, 'src', 'schemas', 'json')).filter((x) => x.endsWith('.json')).length;
  const dirty = (git(dir, ['status', '--porcelain']) || '') !== '';
  return { commit, date, subject, schemaFiles: files, dirty };
}

// The commit of the code measured: the last one that changed anything but
// the report, so the commit that adds the report names the one before it.
function tree() {
  const commit = git(ROOT, ['log', '-1', '--format=%H', '--', '.', ':(exclude)docs/correctness-report.md']);
  const st = spawnSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
  const status = (st.status === 0 ? st.stdout : '').split('\n').filter(Boolean)
    .map((l) => l.slice(3)).filter((f) => f !== 'docs/correctness-report.md').sort();
  return { commit, version: require(path.join(ROOT, 'lib', 'version')), uncommitted: status };
}

const listedInRun = () => { const src = fs.readFileSync(path.join(ROOT, 'tests', 'run.js'), 'utf8'); return (f) => src.includes(JSON.stringify(f)); };

// `run`: also run the test files of the classes whose fixes are all here.
function sweepStatus({ run }) {
  const listed = listedInRun();
  const results = new Map();
  const result = (f) => { if (!results.has(f)) results.set(f, node([path.join(ROOT, f)]).status === 0 ? 'passed' : 'failed'); return results.get(f); };
  return CLASSES.map((c) => {
    const fixes = c.fixes.map((commit) => ({ commit, inTree: spawnSync('git', ['-C', ROOT, 'merge-base', '--is-ancestor', commit, 'HEAD']).status === 0 }));
    const inTree = fixes.every((f) => f.inTree);
    const tests = c.tests.map((file) => {
      const present = fs.existsSync(path.join(ROOT, file));
      const t = { file, present, listed: present && listed(file) };
      if (run) t.result = inTree && present ? result(file) : 'not run';
      return t;
    });
    const s = { id: c.id, inTree, fixes, tests };
    if (run) s.closed = inTree && tests.every((t) => t.present && t.listed && t.result === 'passed');
    return s;
  });
}

function measure({ schemastore }) {
  const record = { format: 'ata-correctness-report/1', tree: tree() };
  record.corpora = { suite: corpusSuite(), schemastore: schemastore ? corpusSchemaStore(path.resolve(schemastore)) : null };
  record.gate = { suite: runGate([]), schemastore: schemastore ? runGate(['--no-suite', '--schemastore', path.resolve(schemastore)]) : null };
  record.dialects = measureSuite();
  record.noEval = measureNoEval();
  record.sweep = sweepStatus({ run: true });
  return record;
}

// ---------------------------------------------------------------------------
// Rendering. Every figure below comes from the record.

const code = (s) => '`' + s + '`';
const short = (h) => (h ? h.slice(0, 7) : 'unknown');
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const cell = (s) => String(s).replace(/\|/g, '\\|');

function nativeLine(n, version) {
  if (n.loaded) return `loaded from ${n.source}, version ${n.found.find((f) => f.source === n.source).version}`;
  if (n.noNative) return 'not loaded, since ATA_NO_NATIVE was set';
  if (n.found.length === 0) return 'not loaded, since none is installed';
  return `not loaded. ${n.found.map((f) => `${f.source} reports version ${f.version}`).join(', ')}, and the package refuses an engine whose version is not its own (${version})`;
}

function pathTable(g) {
  const out = ['| path | error fields compared | order compared | schemas taken | declined | documents | differ | threw | allowed as ATA9000 | other order, none promised | known |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const p of g.paths) out.push(`| ${p.name} | ${p.fields} | ${p.ordered ? 'yes' : 'no'} | ${p.taken} | ${p.declined} | ${p.docs} | ${p.diffs} | ${p.threw} | ${p.abort} | ${p.unordered} | ${p.known} |`);
  return out.join('\n');
}

function render(r) {
  const gates = [['official suite', r.gate.suite]].concat(r.gate.schemastore ? [['SchemaStore', r.gate.schemastore]] : []);
  for (const [, g] of gates) {
    for (const k of g.knownOrder) if (!ORDER_REASONS[k]) throw new Error(`gate.js KNOWN_ORDER entry "${k}" has no reason in scripts/gate-report.js ORDER_REASONS`);
    for (const k of g.known) if (!KNOWN_REASONS[k]) throw new Error(`gate.js KNOWN entry "${k}" has no reason in scripts/gate-report.js KNOWN_REASONS`);
  }
  const classOf = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
  const g0 = r.gate.suite;
  const differ = sum(gates, ([, g]) => sum(g.paths, (p) => p.diffs + p.threw));
  const closed = r.sweep.filter((s) => s.closed);
  const open = r.sweep.filter((s) => !s.closed);
  const dialectsOk = r.dialects.every((d) => d.passed === d.total && d.regressions === 0 && d.exit === 0);
  const noEvalOk = r.noEval.dialects.every((d) => d.passed === d.total) && r.noEval.exit === 0;
  const L = [];
  const p = (...xs) => L.push(...xs);

  p('# Correctness report', '');
  p('This file is written by `node scripts/gate-report.js`. Do not edit it by hand: every figure in it was printed by the run that wrote it, and `tests/test_gate_report.js` fails when the text and the run it records disagree.', '');

  p('## Summary', '');
  p(`- Tree: ata-validator ${r.tree.version} at commit ${code(short(r.tree.commit))}${r.tree.uncommitted.length ? `, with uncommitted changes to ${r.tree.uncommitted.map(code).join(', ')}` : ''}. Node ${g0.node} on ${g0.platform}-${g0.arch}.`);
  p(`- Gate: ${g0.paths.length} paths, each held to the Validator on the same documents. Official suite: ${g0.schemas} schemas.${r.gate.schemastore ? ` SchemaStore: ${r.gate.schemastore.schemas} schemas.` : ' SchemaStore: not run.'} Documents that differ or threw: ${differ}.`);
  p(`- Official JSON Schema Test Suite at ${code(short(r.corpora.suite.commit))}: ${r.dialects.map((d) => `${d.dialect} ${d.passed} of ${d.total}`).join(', ')}.${dialectsOk ? '' : ' Not every case passed; see below.'}`);
  p(`- With \`eval\` and \`new Function\` blocked: ${r.noEval.dialects.map((d) => `${d.dialect} ${d.passed} of ${d.total}`).join(', ')}.${noEvalOk ? '' : ' Not every case passed; see below.'}`);
  p(`- Native engine: ${nativeLine(g0.native, g0.ata)}.${g0.native.loaded ? '' : ' The native paths did not run, and nothing below reports them as passing.'}`);
  p(`- Sweep classes: ${r.sweep.length}. Closed in this tree, with their tests passing: ${closed.length}. Open in this tree: ${open.length}.`);
  p('');

  p('## What the gate compares', '');
  p('`scripts/gate.js` builds each schema through every path the package answers by and compares each path with `new Validator(schema)`, default options, or the options a path is the counterpart of (plain errors, no default filling). For every document it compares:', '');
  p('- the verdict of `validate()` and of the boolean check;');
  p('- the error fields the path promises, in order where it promises order (`rich`: every field of a Validator error; `module`: code, keyword, instancePath, schemaPath, params, message, docUrl; `plain`: keyword, instancePath, schemaPath, params, message, and no other keys);');
  p('- the document afterwards, where the path fills defaults itself.', '');
  p('A path may decline a schema. A declined schema is counted and not compared: that path refuses to build it, and the Validator answers it instead. Two differences are allowed and counted apart. A module that cannot build error detail reports the single error ATA9000 ("allowed as ATA9000"). A path that promises the errors but not their order is compared without order ("other order, none promised"). An entry under "known" is listed in `scripts/gate.js` with its reason, below.', '');
  p('The documents are the official suite\'s test data; for SchemaStore, each schema\'s positive and negative samples and copies of them changed in one place by a seeded generator. Every schema also meets documents no sample holds: empty and non-empty arrays, an empty object, primitives, and for a schema with `properties`, a name on the prototype, an undefined value, a non-enumerable name and an array with a named key. The JSON text path is given only what JSON can carry.', '');

  p('## Corpora', '');
  p('| corpus | commit | date | subject | read by the gate |', '|---|---|---|---|---|');
  const cs = r.corpora.suite;
  p(`| JSON Schema Test Suite (${code('tests/suite')}) | ${code(cs.commit)} | ${cs.date} | ${cell(cs.subject)} | ${DIALECTS.join(', ')}: the required tests, \`optional/format\` and \`optional/non-bmp-regex.json\` |`);
  if (r.corpora.schemastore) { const s = r.corpora.schemastore; p(`| SchemaStore | ${code(s.commit)} | ${s.date} | ${cell(s.subject)} | ${s.schemaFiles} schema files in \`src/schemas/json\`; those with sample documents the Validator builds are checked |`); }
  else p('| SchemaStore | not given | | | not run |');
  p('');
  p(cs.atPin ? 'The suite checkout is at the commit this tree pins.' : `The suite checkout is not at the commit this tree pins (${code(short(cs.pinned))}). The figures are for the checkout.`);
  if (r.corpora.schemastore && r.corpora.schemastore.dirty) p('', 'The SchemaStore checkout had uncommitted changes.');
  p('');

  for (const [name, g] of gates) {
    p(`## Paths, ${name}`, '');
    p(`${g.schemas} schemas the Validator builds. Gate exit status ${g.exit}.`, '');
    p(pathTable(g), '');
  }

  p('## Differences', '');
  const kinds = gates.flatMap(([name, g]) => g.kinds.map((k) => ({ ...k, corpus: name })));
  const reports = gates.flatMap(([name, g]) => g.report.map((x) => ({ x, corpus: name })));
  if (kinds.length === 0 && reports.length === 0) p('None. No path gave an answer that differs from the Validator\'s, and no path threw.', '');
  else {
    for (const k of kinds) p(`- ${k.corpus}: ${k.n} documents of ${code(cell(k.kind))}, the first: ${code(cell(k.first.slice(0, 300)))}`);
    for (const x of reports) p(`- ${x.corpus}: ${code(cell(x.x.slice(0, 300)))}`);
    p('');
  }

  p('## Known exceptions', '');
  const order = [...new Set(gates.flatMap(([, g]) => g.knownOrder))];
  const known = [...new Set(gates.flatMap(([, g]) => g.known))];
  if (order.length === 0 && known.length === 0) p('None are listed in `scripts/gate.js`.', '');
  for (const k of known) p(`- Documents of the kind "${k}": ${KNOWN_REASONS[k]}`);
  for (const k of order) {
    p(`- Error order, for a suite group whose description ends in "${k}". ${ORDER_REASONS[k]}`);
    const seen = gates.flatMap(([name, g]) => g.knownSeen.filter((s) => s.label.endsWith(k)).map((s) => ({ ...s, corpus: name })));
    if (seen.length === 0) p('  It was not met in this run.');
    for (const s of seen) p(`  - ${s.path}, ${s.corpus}: ${code(cell(s.label))}, document kind "${s.tag}".`);
  }
  p('');

  p('## Official test suite', '');
  p(`\`node tests/run_suite.js <dialect>\`, suite at ${code(short(cs.commit))}. Every case of the dialect directory runs; a schema that does not compile counts as failed. \`format\` is an annotation, as the suite expects, and the suite's remote documents are registered from \`tests/suite/remotes\`. The optional tests are not in these figures.`, '');
  p('| dialect | passed | cases | listed known failures | regressions | exit status |', '|---|---|---|---|---|---|');
  for (const d of r.dialects) p(`| ${d.dialect} | ${d.passed} | ${d.total} | ${d.knownFailures} | ${d.regressions} | ${d.exit} |`);
  p('');

  p('## With code generation blocked', '');
  p('`node tests/test_no_eval.js` replaces `eval` and `Function` before the package loads, so that building a function from source throws, turns the native engine off, and runs every case of each dialect directory through `validate()`.', '');
  p('| dialect | passed | cases | failed | errored |', '|---|---|---|---|---|');
  for (const d of r.noEval.dialects) p(`| ${d.dialect} | ${d.passed} | ${d.total} | ${d.failed} | ${d.errored} |`);
  p('');
  p(`Code generation attempts blocked: ${r.noEval.blocked}. Standard Schema check with code generation blocked: ${r.noEval.standardSchema ? 'passed' : 'failed'}. Exit status ${r.noEval.exit}.`, '');

  p('## Native engine', '');
  if (g0.native.loaded) p(`The gate loaded the native engine from ${g0.native.source}. With it loaded, the JSON text path hands long text to it. The gate has no path of its own for the buffer APIs (\`isValid(buffer)\`, \`countValid\`, \`isValidParallel\`, \`isValidNDJSON\`, \`batchIsValid\`).`, '');
  else p(`The native engine was ${nativeLine(g0.native, g0.ata)}. The package uses its JavaScript engine in that case, and so did every run in this report. The native paths did not run: neither the native reading of JSON text nor the buffer APIs on the native walker are covered here.`, '');

  p('## Sweep classes', '');
  p('The classes found by the sweep of 1.x for answers that differ between paths, one per changelog entry of their fixes, whether those fixes are in this tree or not yet merged into it. A class is closed in this tree when every commit that fixes it is in this tree\'s history and every test that holds it is present, listed in `tests/run.js` and passed in this run. The tests of a class whose fix is not in this tree were not run: they would pass without saying anything about the class.', '');
  p('| class | effect before the fix | fix commits | in this tree | tests | result |', '|---|---|---|---|---|---|');
  for (const s of r.sweep) {
    const c = classOf[s.id];
    p(`| ${cell(c.title)} | ${EFFECT[c.effect]} | ${s.fixes.map((f) => code(f.commit)).join(', ')} | ${s.inTree ? 'yes' : 'no'} | ${s.tests.map((t) => code(t.file) + (t.present ? '' : ' (absent)')).join(', ')} | ${s.closed ? 'closed' : s.inTree ? 'open: ' + s.tests.filter((t) => !(t.present && t.listed && t.result === 'passed')).map((t) => `${t.file} ${!t.present ? 'absent' : !t.listed ? 'not in tests/run.js' : t.result}`).join(', ') : 'open: fix not in this tree'} |`);
  }
  p('');

  p('## Not covered', '');
  p('- The gate holds paths to the Validator, not to the specification. A defect the Validator shares with every path does not show in it. The official suite figures are the check against the specification, and they cover what the suite\'s cases cover.');
  p(`- Every run here is Node ${g0.node} on ${g0.platform}-${g0.arch}. Deno, Bun, browsers and Cloudflare Workers were not run, and neither were other operating systems.`);
  p('- The package entries for browsers and Workers (`index.browser.mjs`, `index.edge.js`), `ata-validator/lite`, `ata-validator/compat` and `ata-validator/stream` are not gate paths. How `ata-validator/compat` differs from the default validator is not part of this report.');
  p('- The `ata` command line binary is not run. The modules the gate checks are built through library calls (`toStandaloneModule`, `toCompactModule`, `toSchemaModule`, `compiledModuleFor`), not through the binary.');
  p('- The buffer APIs have no gate path. The native engine with code generation blocked is not run anywhere here: the run with code generation blocked turns the native engine off.');
  p('- The gate leaves out the suite groups whose schema names `http://localhost:1234`, the suite\'s remote documents; `tests/run_suite.js` and `tests/test_no_eval.js` include them.');
  p('- The documents a SchemaStore schema meets are its samples, copies changed in one place and the extra documents above. A schema with no sample document is not checked.');
  p('- The 2.0 entries are not in this tree and not in this report.');
  p('');

  p('## Known open items', '');
  const items = [];
  if (!g0.native.loaded) items.push('The native paths did not run (see Native engine).');
  for (const s of open) items.push(`Sweep class open in this tree: ${classOf[s.id].title}`);
  for (const k of order) items.push(`The error order exception "${k}" in \`scripts/gate.js\`.`);
  if (!r.gate.schemastore) items.push('SchemaStore was not given, so its gate run is missing.');
  if (differ !== 0) items.push(`${differ} documents differ in the gate.`);
  if (items.length === 0) p('None.', '');
  else { for (const x of items) p(`- ${x}`); p(''); }

  p('## Reproduce', '');
  p(`From a clean clone at the commit that adds this file, whose code is that of ${code(short(r.tree.commit))}, with Node and git:`, '');
  p('```sh');
  p('git clone https://github.com/ata-core/ata-validator.git && cd ata-validator');
  p('git checkout <the commit that adds docs/correctness-report.md>');
  p('git submodule update --init tests/suite');
  p('npm ci');
  if (r.corpora.schemastore) {
    p('git clone https://github.com/SchemaStore/schemastore.git ../schemastore');
    p(`git -C ../schemastore checkout ${short(r.corpora.schemastore.commit)}`);
    p('node scripts/gate-report.js --schemastore ../schemastore');
  } else p('node scripts/gate-report.js');
  p('git diff --exit-code docs/correctness-report.md');
  p('```', '');
  p('The last command prints nothing and exits 0 when every figure reproduces. On another machine the Node version, the platform and the native engine line can differ, since `npm ci` installs the native package for that platform when one is published; those lines then differ and the counts are what to compare. `node scripts/gate-report.js --record <file>` also writes the record below as a file. The gate alone: `node scripts/gate.js --schemastore ../schemastore`.', '');

  p('<!-- record');
  // `--` cannot appear in an HTML comment. JSON has it only inside strings, where - reads as the same character.
  p(JSON.stringify(r, null, 1).replace(/--/g, '-\\u002d'));
  p('-->', '');
  return L.join('\n');
}

function parseRecord(md) {
  const m = /\n<!-- record\n([\s\S]*)\n-->\n$/.exec(md);
  if (!m) throw new Error('docs/correctness-report.md carries no record');
  return JSON.parse(m[1]);
}

module.exports = { measure, render, parseRecord, runGate, measureSuite, measureNoEval, corpusSuite, sweepStatus, CLASSES, OUT };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; };
  try {
    if (argv.includes('--check')) {
      const md = fs.readFileSync(OUT, 'utf8');
      if (render(parseRecord(md)) !== md) { console.error('docs/correctness-report.md does not match its own record: run node scripts/gate-report.js'); process.exit(1); }
      console.log('docs/correctness-report.md matches its record');
      process.exit(0);
    }
    const record = arg('--from') ? JSON.parse(fs.readFileSync(arg('--from'), 'utf8')) : measure({ schemastore: arg('--schemastore') });
    if (arg('--record')) fs.writeFileSync(arg('--record'), JSON.stringify(record, null, 1) + '\n');
    fs.writeFileSync(OUT, render(record));
    console.log(`wrote ${path.relative(process.cwd(), OUT) || OUT}`);
  } catch (e) { console.error(e && e.stack ? e.stack : e); process.exit(2); }
}

'use strict';

// The browser entry (index.browser.mjs) carries no code generator: every
// schema starts on the interpreted engine, and a validator that reaches
// TIER_CALLS loads the generator through a dynamic import and rebuilds itself
// on generated code (lib/tiering.js). The answers, valid and errors alike,
// must not change across the switch, a cold validator must stay interpreted
// and download nothing, and parse() must say how to have the generator from
// the start. Run in a child process so this file's other imports do not
// register the generator first.

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
// Absolute paths go to import() as file URLs: on Windows a bare `C:\\...` is
// read as a URL scheme and refused.
const url = (...p) => JSON.stringify(pathToFileURL(path.join(__dirname, '..', ...p)).href);

const script = `
const { Validator } = await import(${url('index.browser.mjs')});
const core = (await import(${url('lib', 'validator-core.js')})).default;
const out = {};
const schema = { type: 'object', properties: { a: { type: 'integer', minimum: 1 }, s: { type: 'string', maxLength: 3 }, e: { type: 'string', format: 'email' } }, required: ['a'], additionalProperties: false };
const docs = [{ a: 1 }, { a: 0 }, { s: 'abcd' }, { a: 2, s: 'ab', e: 'x' }, { a: 1, z: 1 }, 'str', null];
const hot = new Validator(schema);
const cold = new Validator({ type: 'object', properties: { n: { type: 'string', minLength: 1 } } });
out.coldEngine = (cold.validate({ n: 'x' }), cold._engine);
out.startEngine = (hot.validate({ a: 1 }), hot._engine);
out.registeredAtStart = core._codegenRegistered();
try { hot.parse({ a: 1 }); out.parseBefore = 'ok'; } catch (e) { out.parseBefore = e.message; }
const before = docs.map((d) => JSON.stringify(hot.validate(d).errors));
for (let i = 0; i < core._tiering.TIER_CALLS + 10; i++) hot.isValidObject(docs[i % docs.length]);
await core._tiering.settled();
out.hotEngine = hot._engine;
out.coldEngineAfter = cold._engine;
out.same = docs.every((d, i) => JSON.stringify(hot.validate(d).errors) === before[i]) && docs.every((d) => hot.isValidObject(d) === (hot.validate(d).valid));
try { out.parseAfter = JSON.stringify(new Validator(schema).parse({ a: 1 })); } catch (e) { out.parseAfter = 'threw ' + e.message; }
console.log(JSON.stringify(out));
`;
const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim().split('\n').pop());
assert.strictEqual(r.registeredAtStart, false, 'the browser entry starts without the code generator');
assert.strictEqual(r.startEngine, 'interpreter');
assert.strictEqual(r.coldEngine, 'interpreter');
assert.match(r.parseBefore, /ata-validator\/codegen/, 'parse() before the generator names the way to have it');
assert.strictEqual(r.hotEngine, 'codegen', 'a hot validator rebuilds itself on generated code');
assert.strictEqual(r.coldEngineAfter, 'interpreter', 'a cold validator is left as it is');
assert.strictEqual(r.same, true, 'answers and errors are the same across the switch');
assert.strictEqual(r.parseAfter, '{"a":1}', 'parse() works once the generator is in');

// Every entry point counts, whichever path answers it: a simple schema checked
// only through isValidObject() answers from the tier-0 plan walk, which once
// skipped the counter and stayed four times slower for good.
const entries = execFileSync(process.execPath, ['--input-type=module', '-e', `
const { Validator } = await import(${url('index.browser.mjs')});
const core = (await import(${url('lib', 'validator-core.js')})).default;
const schemas = { simple: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, rich: { type: 'object', properties: { a: { type: 'string', format: 'email' }, n: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }, required: ['a'], additionalProperties: false } };
const d = { a: 'x@y.co' }, s = JSON.stringify(d), cold = [];
const all = [];
for (const kind of ['simple', 'rich']) for (const opts of [undefined, { coerceTypes: true }, { useDefaults: true }]) for (const entry of ['validate', 'isValidObject', 'validateJSON', 'isValidJSON']) {
  const v = new Validator(schemas[kind], opts);
  for (let i = 0; i < core._tiering.TIER_CALLS + 5; i++) entry.endsWith('JSON') ? v[entry](s) : v[entry](d);
  all.push([v, kind + ' ' + JSON.stringify(opts || {}) + ' ' + entry]);
}
await core._tiering.settled();
console.log(JSON.stringify(all.filter(([v]) => v._engine !== 'codegen').map(([, n]) => n)));
`], { encoding: 'utf8' }).trim().split('\n').pop();
assert.strictEqual(entries, '[]', 'every entry point tiers up: ' + entries);
const onlyVerdict = execFileSync(process.execPath, ['--input-type=module', '-e', `
const { Validator } = await import(${url('index.browser.mjs')});
const core = (await import(${url('lib', 'validator-core.js')})).default;
const v = new Validator({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
for (let i = 0; i < core._tiering.TIER_CALLS + 5; i++) v.isValidObject({ a: 'x' });
await core._tiering.settled();
console.log(v._engine);
`], { encoding: 'utf8' }).trim();
assert.strictEqual(onlyVerdict, 'codegen', 'a simple schema checked only through isValidObject() tiers up');

// Hot means TIER_CALLS calls within WINDOW_MS: calls spread out further, a
// form checked as the user types, never load the generator. And once it is
// in, a validator turning hot is rebuilt in a task of its own, not inside the
// call that crossed the line.
const pace = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
const { Validator } = await import(${url('index.browser.mjs')});
const core = (await import(${url('lib', 'validator-core.js')})).default;
const T = core._tiering, out = {};
const slow = new Validator({ type: 'object', properties: { a: { type: 'string' } } });
for (let i = 0; i < T.TIER_CALLS - 10; i++) slow.validate({ a: 'x' });
await new Promise((r) => setTimeout(r, T.WINDOW_MS + 100));
for (let i = 0; i < 20; i++) slow.validate({ a: 'x' });
out.slowLoading = T.loading !== null;
const next = new Validator({ type: 'object', properties: { c: { type: 'number' } } });
next.validate({ c: 1 });
const hot = new Validator({ type: 'object', properties: { b: { type: 'number' } } });
for (let i = 0; i < T.TIER_CALLS + 5; i++) hot.validate({ b: 1 });
await T.settled();
out.hot = hot._engine;
out.slow = slow._engine;
out.nextBefore = next._engine;
for (let i = 0; i < T.TIER_CALLS + 5; i++) next.validate({ c: 1 });
out.sync = next._engine;
await T.settled();
out.after = next._engine;
console.log(JSON.stringify(out));
`], { encoding: 'utf8' }).trim().split('\n').pop());
assert.strictEqual(pace.slowLoading, false, 'calls spread over more than the window load nothing');
assert.strictEqual(pace.slow, 'interpreter');
assert.strictEqual(pace.hot, 'codegen');
assert.strictEqual(pace.nextBefore, 'interpreter', 'a validator compiled before the generator stays interpreted until it is hot');
assert.strictEqual(pace.sync, 'interpreter', 'no compile inside the call that crossed the line');
assert.strictEqual(pace.after, 'codegen');

// The rebuilt validator keeps V8's fast object shape. Resetting it with
// `delete` once turned it into a dictionary and every method read slower
// (20 ns a check against 17), which no answer would show.
const shape = execFileSync(process.execPath, ['--allow-natives-syntax', '--input-type=module', '-e', `
const { Validator } = await import(${url('index.browser.mjs')});
const core = (await import(${url('lib', 'validator-core.js')})).default;
const v = new Validator({ type: 'object', properties: { a: { type: 'string', format: 'email' } } });
for (let i = 0; i < core._tiering.TIER_CALLS + 5; i++) v.validate({ a: 'x@y.co' });
await core._tiering.settled();
console.log(v._engine + ' ' + %HasFastProperties(v));
`], { encoding: 'utf8' }).trim();
assert.strictEqual(shape, 'codegen true', 'the rebuilt validator keeps fast properties');

// Where code generation is blocked the generator is not downloaded at all.
const blocked = JSON.parse(execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', script.replace("await core._tiering.settled();", "out.loaded = await core._tiering.loading;").replace("console.log(JSON.stringify(out));", "console.log(JSON.stringify(out));")], { encoding: 'utf8' }).trim().split('\n').pop());
assert.strictEqual(blocked.loaded, false, 'blocked code generation: nothing is loaded');
assert.strictEqual(blocked.hotEngine, 'interpreter');
assert.strictEqual(blocked.same, true);

// 'ata-validator/codegen' has generated code from the first call.
const eager = execFileSync(process.execPath, ['--input-type=module', '-e', `
await import(${url('codegen.mjs')});
const { Validator } = await import(${url('index.browser.mjs')});
const v = new Validator({ type: 'string' }); v.validate('x'); console.log(v._engine);
`], { encoding: 'utf8' }).trim();
assert.strictEqual(eager, 'codegen', "import 'ata-validator/codegen' compiles from the first call");
console.log('ok: the browser entry loads the code generator on demand and answers the same on both engines');

'use strict';

// The browser entry warms the interpreted engine once per page, when the page
// is idle (200 ms after where there is no requestIdleCallback, as in Node),
// by checking a small schema of its own (lib/tiering.js): the first check a
// page makes otherwise pays for V8 compiling the engine. The warm-up
// must be scheduled by the first validator built, run once, leave the
// caller's validators uncompiled and unchanged, download no code generator,
// and be skipped when a validator has compiled before it runs. Each case runs
// in a child process so this file's other imports do not register the
// generator first.

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
const url = (...p) => JSON.stringify(pathToFileURL(path.join(__dirname, '..', ...p)).href);

const run = (body) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
const { Validator } = await import(${url('index.browser.mjs')});
const core = (await import(${url('lib', 'validator-core.js')})).default;
const out = {};
const idle = () => new Promise((r) => setTimeout(r, 250));
${body}
console.log(JSON.stringify(out));
`], { encoding: 'utf8' }).trim().split('\n').pop());

// Built, then idle: the warm-up runs once and touches nothing of the caller's.
const a = run(`
out.beforeAny = core._tiering.warm;
const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 3 } }, required: ['n'] };
const v = new Validator(schema);
out.scheduled = core._tiering.warm;
await idle();
out.after = core._tiering.warm;
out.callerCompiled = v._initialized === true;
out.registered = core._codegenRegistered();
new Validator({ type: 'string' });
await idle();
out.again = core._tiering.warm;
out.errors = JSON.stringify(v.validate({ n: 1 }).errors.map((e) => [e.keyword, e.instancePath]));
out.valid = v.validate({ n: 3 }).valid;
`);
assert.strictEqual(a.beforeAny, 0, 'nothing is scheduled before a validator is built');
assert.strictEqual(a.scheduled, 1, 'the first validator built schedules the warm-up');
assert.strictEqual(a.after, 2, 'the warm-up runs when the page is idle');
assert.strictEqual(a.callerCompiled, false, "the caller's validator is not compiled by the warm-up");
assert.strictEqual(a.registered, false, 'the warm-up downloads no code generator');
assert.strictEqual(a.again, 2, 'the warm-up runs once per page');
assert.strictEqual(a.errors, '[["minimum","/n"]]');
assert.strictEqual(a.valid, true);

// A check before the page is idle compiles the engine itself: the warm-up is dropped.
for (const call of ['validate({ n: 1 })', 'isValidObject({ n: 1 })']) {
  const b = run(`
const v = new Validator({ type: 'object', properties: { n: { type: 'integer', minimum: 3 } } });
v.${call};
out.afterCheck = core._tiering.warm;
let built = 0;
const ctor = core.Validator.prototype._ensureCompiled;
core.Validator.prototype._ensureCompiled = function () { built++; return ctor.call(this); };
await idle();
out.compiledInIdle = built;
`);
  assert.strictEqual(b.afterCheck, 2, `${call} before idle drops the warm-up`);
  assert.strictEqual(b.compiledInIdle, 0, `${call} before idle: nothing is compiled when the page is idle`);
}

// The engine for a validator built before the page was idle is built then
// and adopted at its first check, answering exactly as one built at the check.
const c = run(`
const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 3 }, s: { type: 'string', pattern: '^[0-9]{5}$' } }, required: ['n'] };
const v = new Validator(schema);
await idle();
out.compiledInIdle = v._initialized === true;
const docs = [{ n: 1, s: 'x' }, { n: 5, s: '12345' }, {}, { n: 'a' }];
out.got = docs.map((d) => JSON.stringify(v.validate(d).errors));
out.adopted = core._tiering.adopted;
const fresh = new Validator(JSON.parse(JSON.stringify(schema)));
out.want = docs.map((d) => JSON.stringify(fresh.validate(d).errors));
`);
assert.strictEqual(c.compiledInIdle, false, 'the validator itself is not compiled while the page is idle');
assert.strictEqual(c.adopted, 1, 'the engine built while idle is adopted at the first check');
assert.deepStrictEqual(c.got, c.want, 'an adopted engine answers as one built at the check');

// addSchema() after the page was idle still works and is honored.
const d = run(`
const v = new Validator({ type: 'object', properties: { p: { $ref: 'https://example.com/pos' } } });
await idle();
try { v.addSchema({ $id: 'https://example.com/pos', type: 'number', minimum: 0 }); out.added = true; } catch (e) { out.added = e.message; }
out.valid = v.validate({ p: 1 }).valid;
out.rejects = v.validate({ p: -1 }).valid === false;
out.adopted = core._tiering.adopted;
`);
assert.strictEqual(d.added, true, 'addSchema() after the page was idle does not throw');
assert.strictEqual(d.valid, true);
assert.strictEqual(d.rejects, true, 'the schema added after the page was idle is applied');
assert.strictEqual(d.adopted, 0, 'an engine built before addSchema() is not adopted');

// A change to the schema object between construction and the first check is honored.
const e = run(`
const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 3 } } };
const v = new Validator(schema);
await idle();
schema.properties.n.minimum = 10;
out.valid = v.validate({ n: 5 }).valid;
out.adopted = core._tiering.adopted;
`);
assert.strictEqual(e.valid, false, 'the schema as it is at the first check decides');
assert.strictEqual(e.adopted, 0, 'an engine built from the old schema is not adopted');

// Custom keywords: their compile functions are the caller's code and run at the first check only.
const f = run(`
let calls = 0;
const v = new Validator({ type: 'object', properties: { n: { even: true } } }, { keywords: { even: { compile: () => { calls++; return (d) => d % 2 === 0; } } } });
await idle();
out.callsInIdle = calls;
out.rejects = v.validate({ n: 3 }).valid === false;
out.calls = calls;
`);
assert.strictEqual(f.callsInIdle, 0, 'no keyword compile function runs while the page is idle');
assert.strictEqual(f.rejects, true);
assert.strictEqual(f.calls, 1);

console.log('ok: browser warm-up runs once when idle, engines built while idle are adopted only on unchanged inputs');

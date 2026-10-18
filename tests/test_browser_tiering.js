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

const script = `
const { Validator } = await import(${JSON.stringify(path.join(__dirname, '..', 'index.browser.mjs'))});
const core = (await import(${JSON.stringify(path.join(__dirname, '..', 'lib', 'validator-core.js'))})).default;
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
await core._tiering.loading;
await new Promise((r) => setTimeout(r, 0));
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

// Where code generation is blocked the generator is not downloaded at all.
const blocked = JSON.parse(execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', script.replace("await core._tiering.loading;", "out.loaded = await core._tiering.loading;").replace("console.log(JSON.stringify(out));", "console.log(JSON.stringify(out));")], { encoding: 'utf8' }).trim().split('\n').pop());
assert.strictEqual(blocked.loaded, false, 'blocked code generation: nothing is loaded');
assert.strictEqual(blocked.hotEngine, 'interpreter');
assert.strictEqual(blocked.same, true);

// 'ata-validator/codegen' has generated code from the first call.
const eager = execFileSync(process.execPath, ['--input-type=module', '-e', `
await import(${JSON.stringify(path.join(__dirname, '..', 'codegen.mjs'))});
const { Validator } = await import(${JSON.stringify(path.join(__dirname, '..', 'index.browser.mjs'))});
const v = new Validator({ type: 'string' }); v.validate('x'); console.log(v._engine);
`], { encoding: 'utf8' }).trim();
assert.strictEqual(eager, 'codegen', "import 'ata-validator/codegen' compiles from the first call");
console.log('ok: the browser entry loads the code generator on demand and answers the same on both engines');

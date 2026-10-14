'use strict';

// Every program compiled at run time carries a tag that differs per compile
// (seqTag in lib/js-compiler.js): V8 keeps one compiled function, with one
// feedback vector, per source text of a `new Function` call, so two schemas
// that generate the same code, two copies under different `$id`s, shared
// their inline caches and ran megamorphic on each other's data shapes. The
// emitted standalone source must not carry the tag: a build is the same text
// whatever was compiled before it in the process.

const assert = require('assert');
const cf = require('../lib/compile-fn.js');
const sources = [];
const orig = cf.compileFunction;
cf.compileFunction = (...a) => { sources.push(a[a.length - 1]); return orig(...a) };
const { Validator } = require('..');
const aot = require('../lib/aot.js');

const mk = (id) => ({ $id: 'https://example.test/' + id, type: 'array', items: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a'] } });
const a = new Validator(mk('a'));
const b = new Validator(mk('b'));
const bad = [{ a: 1 }];
a.validate(bad).errors; b.validate(bad).errors;
a.isValidObject(bad); b.isValidObject(bad);
const tagged = sources.filter((s) => /^\/\*\d+\*\//.test(s));
assert.ok(tagged.length >= 2, `run-time programs are tagged (${tagged.length} of ${sources.length})`);
const untag = (s) => s.replace(/^\/\*\d+\*\//, '');
const byBody = new Map();
for (const s of tagged) { const k = untag(s); byBody.set(k, (byBody.get(k) || 0) + 1) }
const shared = [...byBody.values()].filter((n) => n > 1).length;
assert.ok(shared >= 1, 'the two schemas generate the same code apart from the tag (the case the tag is for)');
assert.strictEqual(new Set(tagged).size, tagged.length, 'no two run-time programs share a source text');

const m1 = aot.toStandaloneModule(new Validator(mk('a')), { format: 'esm' });
for (let i = 0; i < 5; i++) new Validator({ type: 'object', properties: { ['q' + i]: { type: 'string' } } }).validate({});
const m2 = aot.toStandaloneModule(new Validator(mk('a')), { format: 'esm' });
assert.strictEqual(m1, m2, 'a standalone build does not depend on what was compiled before it');
assert.ok(!/\/\*\d+\*\//.test(m1), 'no tag in the emitted source');
console.log(`ok: run-time programs carry a per-compile tag (${tagged.length} programs), standalone builds do not`);

'use strict';

// lib/aot-impl.js writes what the code generator produces, so it registers
// the generator itself. In the browser the generator loads on demand, and a
// page that called bundleStandalone() before it had loaded got a module whose
// every validator was null, with no error. This loads the core without any
// entry that registers the generator, as the browser build does, and checks
// that the emitters still compile.
const assert = require('assert');
const core = require('../lib/validator-core.js');
// What index.browser.mjs does: the generator arrives through a dynamic
// import once a validator is hot, so until then the core has none.
core._registerTiering(require('../lib/tiering.js').createTiering(() => new Promise(() => {})));
assert.strictEqual(core._codegenRegistered(), false, 'the browser core starts with no generator registered');
const { bundleStandalone } = require('../lib/aot-impl.js');
assert.strictEqual(core._codegenRegistered(), true, 'loading the emitters registers the generator');
const schema = { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] };
const code = bundleStandalone(core.Validator, [schema], { format: 'cjs' });
assert.ok(typeof code === 'string' && !/validators=\[null\]/.test(code), 'bundleStandalone compiles the schema instead of a null validator');
const m = { exports: {} };
new Function('module', 'exports', code)(m, m.exports);
const [v] = m.exports.validators || m.exports.default || m.exports;
assert.ok(v && (typeof v === 'object' || typeof v === 'function'), 'the bundle carries a validator');
console.log('ok: the ahead-of-time emitters register the code generator they need');
